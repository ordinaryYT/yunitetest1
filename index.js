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

const pendingVerifications = new Map();
const userConnections = new Map();

// ✅ Command queue for AHK
const commandQueue = [];

app.use(express.json());

/* ==========================================================
   FortniteAPI.io Verification (Hidden Source)
   ========================================================== */
const verifyWithFortniteAPI = async (username) => {
    console.log(`\n🔍 Checking FortniteAPI.io for: "${username}"`);

    try {
        const response = await axios.get(
            `https://fortniteapi.io/v1/lookup?username=${encodeURIComponent(username)}`,
            {
                headers: {
                    Authorization: process.env.FORTNITE_API_KEY
                },
                timeout: 10000
            }
        );

        if (response.status === 200 && response.data && response.data.result) {
            console.log(`✅ SUCCESS: Username "${username}" verified!`);
            return {
                verified: true,
                username: response.data.username || username,
                accountId: response.data.account_id
            };
        } else {
            console.log(`❌ Username "${username}" not found`);
            return { verified: false, error: 'Username not found' };
        }
    } catch (error) {
        console.log('🚨 FortniteAPI.io failed:', error.response?.status || error.message);
        return { verified: false, error: 'FortniteAPI.io unavailable' };
    }
};

/* ==========================================================
   API Test
   ========================================================== */
const testFortniteAPI = async () => {
    console.log('🧪 Testing FortniteAPI.io...');
    if (!process.env.FORTNITE_API_KEY) {
        console.log('⚠️  No API key provided');
        return false;
    }

    try {
        const response = await axios.get('https://fortniteapi.io/v1/lookup?username=Ninja', {
            headers: { Authorization: process.env.FORTNITE_API_KEY },
            timeout: 5000
        });

        if (response.status === 200 && response.data.result) {
            console.log('✅ FortniteAPI.io is WORKING!');
            return true;
        } else {
            console.log('❌ FortniteAPI.io test failed.');
            return false;
        }
    } catch (error) {
        console.log('❌ FortniteAPI.io test failed:', error.response?.status || error.message);
        return false;
    }
};

/* ==========================================================
   Discord Bot Ready
   ========================================================== */
client.once('ready', async () => {
    console.log(`\n✅ Logged in as ${client.user.tag}`);
    console.log(`🔗 Bot is in ${client.guilds.cache.size} servers`);
    console.log('\n--- STARTUP FORTNITE API TEST ---');
    await testFortniteAPI();
    console.log('--- STARTUP COMPLETE ---\n');
});

/* ==========================================================
   Commands
   ========================================================== */
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Admin-only: send verify message
    if (message.content.startsWith('!sendverify')) {
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.reply('❌ You need administrator permissions to use this command.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 Fortnite Account Verification')
            .setDescription(`**To participate in custom games, verify your Fortnite account:**
            
1. **React with ✋ to this message**
2. **The bot will DM you for your Fortnite username**
3. **Follow the instructions in DMs**

⚠️ **Important:** You must use your exact Fortnite username or you won't be added to games.`)
            .setColor(0x0099FF)
            .setFooter({ text: 'Verification System' });

        const sentMessage = await message.channel.send({ embeds: [embed] });
        await sentMessage.react('✋');

        pendingVerifications.set(sentMessage.id, {
            channelId: message.channel.id,
            guildId: message.guild.id
        });

        console.log(`📝 Verification message sent in channel: ${message.channel.name}`);
    }

    // Backup command — manual review only
    if (message.content.startsWith('!overide')) {
        const args = message.content.split(' ');
        if (args.length < 2) {
            return message.reply('Usage: `!overide YourFortniteUsername`');
        }

        const fortniteUsername = args.slice(1).join(' ');
        console.log(`\n📨 Manual override submission from ${message.author.tag}: ${fortniteUsername}`);

        const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);

        await message.author.send(
            `📝 Your Fortnite username **"${fortniteUsername}"** has been submitted for staff review.\nPlease wait for verification.`
        );

        const embed = new EmbedBuilder()
            .setTitle('🧾 MANUAL VERIFICATION REQUEST')
            .setColor(0xFFA500)
            .addFields(
                { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                { name: '🎯 Submitted Username', value: fortniteUsername, inline: true },
                { name: '⚠️ Status', value: 'Pending staff review', inline: false }
            )
            .setTimestamp();

        await fortniteChannel.send({ embeds: [embed] });
        console.log(`📤 Manual verification request sent for ${message.author.tag}`);
    }

    // Admin: API status
    if (message.content.startsWith('!apistatus') && message.member.permissions.has('ADMINISTRATOR')) {
        const apiStatus = await testFortniteAPI();
        await message.reply(`Fortnite verification API: ${apiStatus ? '✅ WORKING' : '❌ FAILED'}`);
    }
});

/* ==========================================================
   Reaction Handler
   ========================================================== */
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Error fetching reaction:', error);
            return;
        }
    }

    const messageId = reaction.message.id;
    const verificationData = pendingVerifications.get(messageId);

    if (verificationData && reaction.emoji.name === '✋') {
        console.log(`✋ Reaction from ${user.tag} on verification message`);

        try {
            const dm = await user.send(`**Please type your Fortnite username.**\n\nPlease only write your Fortnite username in this DM otherwise you will not be added to the custom game.\n\nAlternatively if this doesn't work type \`!overide yourfortniteusername\`\n\nPlease note if this name is wrong you will not be added to the custom game.`);

            pendingVerifications.set(user.id, {
                messageId: messageId,
                dmChannelId: dm.channel.id,
                startedAt: new Date()
            });

            console.log(`📩 DM sent to ${user.tag}`);
        } catch (error) {
            console.error('❌ Could not send DM to user:', error.message);
            const originalChannel = await client.channels.fetch(verificationData.channelId);
            await originalChannel.send(`<@${user.id}> I couldn't send you a DM! Please make sure your DMs are open and try again.`);
        }
    }
});

/* ==========================================================
   DM Handler (Automatic Verification)
   ========================================================== */
client.on('messageCreate', async (message) => {
    if (message.guild || message.author.bot) return;

    const userData = pendingVerifications.get(message.author.id);
    if (userData) {
        const fortniteUsername = message.content.trim();
        console.log(`📨 DM from ${message.author.tag}: "${fortniteUsername}"`);

        const result = await verifyWithFortniteAPI(fortniteUsername);
        const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);

        if (result.verified) {
            await message.author.send(`🎮 FORTNITE ACCOUNT VERIFIED\n🎯 Epic Games: ${result.username}`);

            const embed = new EmbedBuilder()
                .setTitle('🎮 FORTNITE ACCOUNT VERIFIED')
                .setColor(0x00FF00)
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
                method: 'dm',
                verifiedAt: new Date()
            });

            // 🧩 Queue AHK command
            const newCommand = `script botname sigmafish69 add-friend ${result.accountId}`;
            commandQueue.push(newCommand);
            console.log(`💾 Queued AHK command: ${newCommand}`);

            console.log(`✅ DM Verification SUCCESS for ${message.author.tag}: ${result.username}`);
        } else {
            await message.author.send(`❌ VERIFICATION FAILED\n\nThe username "${fortniteUsername}" was not found.\nPlease check your spelling or make sure the account exists.`);

            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ VERIFICATION FAILED')
                .setColor(0xFF0000)
                .addFields(
                    { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                    { name: '❌ Attempted Username', value: fortniteUsername, inline: true },
                    { name: '📝 Status', value: result.error || 'Username not found', inline: false }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [errorEmbed] });
            console.log(`❌ DM Verification FAILED for ${message.author.tag}: ${fortniteUsername}`);
        }

        pendingVerifications.delete(message.author.id);
    }
});

/* ==========================================================
   Express Endpoints
   ========================================================== */
app.get('/', (req, res) => {
    res.send('✅ Fortnite Discord Bot is running.');
});

// Endpoint for AHK to fetch next queued command
app.get('/next-command', (req, res) => {
    if (commandQueue.length > 0) {
        const nextCmd = commandQueue.shift();
        console.log(`📤 AHK fetched command: ${nextCmd}`);
        res.send(nextCmd);
    } else {
        res.send('none');
    }
});

/* ==========================================================
   Start Server
   ========================================================== */
app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
