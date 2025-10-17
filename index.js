const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions
    ]
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const pendingVerifications = new Map();
const userConnections = new Map();

// ✅ Queue of commands for AHK
let commandQueue = [];
let commandIdCounter = 1;

/* ==========================================================
   FortniteAPI.io Verification
   ========================================================== */
const verifyWithFortniteAPI = async (username) => {
    console.log(`\n🔍 Checking FortniteAPI.io for: "${username}"`);
    try {
        const response = await axios.get(
            `https://fortniteapi.io/v1/lookup?username=${encodeURIComponent(username)}`,
            {
                headers: { Authorization: process.env.FORTNITE_API_KEY },
                timeout: 10000
            }
        );

        if (response.status === 200 && response.data && response.data.result) {
            return {
                verified: true,
                username: response.data.username || username,
                accountId: response.data.account_id
            };
        } else return { verified: false, error: 'Username not found' };
    } catch (err) {
        return { verified: false, error: 'FortniteAPI.io unavailable' };
    }
};

/* ==========================================================
   Helper Functions
   ========================================================== */
const queueCommand = (botname, cmd) => {
    const newCmd = {
        id: commandIdCounter++,
        botname,
        command: cmd
    };
    commandQueue.push(newCmd);
    console.log(`💾 Queued command #${newCmd.id}: ${botname} → ${cmd}`);
};

/* ==========================================================
   Bot Events
   ========================================================== */
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Admin command: send verification message
    if (message.content.startsWith('!sendverify')) {
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.reply('❌ You need administrator permissions.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 Fortnite Account Verification')
            .setDescription(`**To participate in custom games, verify your Fortnite account:**
1. **React with ✋**
2. **Check your DMs**
3. **Follow instructions there**

⚠️ Use your *exact* Fortnite name.`)
            .setColor(0x0099ff)
            .setFooter({ text: 'Verification System' });

        const sent = await message.channel.send({ embeds: [embed] });
        await sent.react('✋');
        pendingVerifications.set(sent.id, {
            channelId: message.channel.id,
            guildId: message.guild.id
        });
        return;
    }

    // Manual override command
    if (message.content.startsWith('!overide')) {
        const args = message.content.split(' ');
        if (args.length < 2)
            return message.reply('Usage: `!overide YourFortniteUsername`');

        const fortniteUsername = args.slice(1).join(' ');
        const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);

        await message.author.send(
            `📝 Your Fortnite username **"${fortniteUsername}"** has been submitted for staff review.`
        );

        const embed = new EmbedBuilder()
            .setTitle('🧾 MANUAL VERIFICATION REQUEST')
            .setColor(0xffa500)
            .addFields(
                { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                { name: '🎯 Submitted Username', value: fortniteUsername, inline: true },
                { name: '⚠️ Status', value: 'Pending staff review', inline: false }
            )
            .setTimestamp();

        await fortniteChannel.send({ embeds: [embed] });
        console.log(`📤 Manual submission from ${message.author.tag}: ${fortniteUsername}`);
    }
});

/* ==========================================================
   Reaction to Verification Embed
   ========================================================== */
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) try { await reaction.fetch(); } catch { return; }

    const data = pendingVerifications.get(reaction.message.id);
    if (data && reaction.emoji.name === '✋') {
        try {
            const dm = await user.send(
                `**Please type your Fortnite username.**\n\nAlternatively, use \`!overide yourfortniteusername\` if this fails.`
            );
            pendingVerifications.set(user.id, {
                messageId: reaction.message.id,
                dmChannelId: dm.channel.id,
                startedAt: new Date()
            });
        } catch {
            const ch = await client.channels.fetch(data.channelId);
            ch.send(`<@${user.id}> I couldn't DM you. Please enable DMs and try again.`);
        }
    }
});

/* ==========================================================
   DM Handler (Verification)
   ========================================================== */
client.on('messageCreate', async (message) => {
    if (message.guild || message.author.bot) return;
    const data = pendingVerifications.get(message.author.id);
    if (!data) return;

    const fortniteUsername = message.content.trim();
    console.log(`📨 DM from ${message.author.tag}: "${fortniteUsername}"`);

    const result = await verifyWithFortniteAPI(fortniteUsername);
    const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);

    if (result.verified) {
        await message.author.send(`🎮 VERIFIED\n🎯 Epic Games: ${result.username}`);

        const embed = new EmbedBuilder()
            .setTitle('🎮 FORTNITE ACCOUNT VERIFIED')
            .setColor(0x00ff00)
            .addFields(
                { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                { name: '🎯 Epic Games', value: result.username, inline: true },
                { name: '🆔 Account ID', value: result.accountId, inline: false },
                { name: '📝 Method', value: 'DM Verification', inline: true }
            )
            .setTimestamp();
        await fortniteChannel.send({ embeds: [embed] });

        userConnections.set(message.author.id, {
            epicUsername: result.username,
            accountId: result.accountId,
            verifiedAt: new Date()
        });

        // Queue JSON command for AHK
        queueCommand('sigmafish69', `add-friend ${result.accountId}`);
    } else {
        await message.author.send(
            `❌ VERIFICATION FAILED\n"${fortniteUsername}" not found.`
        );
    }

    pendingVerifications.delete(message.author.id);
});

/* ==========================================================
   Express Endpoints (for AHK)
   ========================================================== */

// Health check
app.get('/', (_, res) => res.send('✅ Fortnite bot running.'));

// AHK fetch endpoint
app.get('/fetch-command', (req, res) => {
    if (commandQueue.length > 0) {
        const next = commandQueue[0];
        console.log(`📤 AHK fetching command id=${next.id}`);
        res.json(next);
    } else {
        res.json({});
    }
});

// AHK acknowledge endpoint
app.post('/ack-command', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const index = commandQueue.findIndex((c) => c.id === id);
    if (index !== -1) {
        console.log(`🗑️  Command id=${id} acknowledged and removed.`);
        commandQueue.splice(index, 1);
    } else {
        console.log(`⚠️  Ack for unknown id=${id}`);
    }
    res.json({ success: true });
});

/* ==========================================================
   Start Server
   ========================================================== */
app.listen(PORT, () => console.log(`🚀 Server started on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
