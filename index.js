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

// Store data
const pendingVerifications = new Map();
const userConnections = new Map();

app.use(express.json());

// FortniteAPI.io verification
const verifyFortniteUsername = async (username) => {
    try {
        const response = await axios.get(`https://fortniteapi.io/v1/lookup?username=${encodeURIComponent(username)}`, {
            headers: {
                'Authorization': process.env.FORTNITE_API_IO_KEY
            }
        });
        
        if (response.data.result) {
            return {
                verified: true,
                username: response.data.account.name,
                accountId: response.data.account.id
            };
        }
    } catch (error) {
        console.error('FortniteAPI.io error:', error.response?.data || error.message);
    }
    return { verified: false };
};

// Bot events
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// Send verification message and wait for reactions
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Command to send the verification message
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
        
        // Store message info for reaction handling
        pendingVerifications.set(sentMessage.id, {
            channelId: message.channel.id,
            guildId: message.guild.id
        });
    }

    // Override command
    if (message.content.startsWith('!overide')) {
        const args = message.content.split(' ');
        if (args.length < 2) {
            return message.reply('Usage: `!overide YourFortniteUsername`');
        }

        const fortniteUsername = args.slice(1).join(' ');
        const result = await verifyFortniteUsername(fortniteUsername);

        // Get the Fortnite channel
        const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);

        if (result.verified) {
            // Send to user
            await message.author.send(`🎮 FORTNITE ACCOUNT VERIFIED\n🎯 Epic Games: ${result.username}`);

            // Send to Fortnite channel
            const embed = new EmbedBuilder()
                .setTitle('🎮 FORTNITE ACCOUNT VERIFIED')
                .setColor(0x00FF00)
                .addFields(
                    { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                    { name: '🎯 Epic Games', value: result.username, inline: true },
                    { name: '🆔 Account ID', value: result.accountId, inline: false },
                    { name: '⚠️ Method', value: 'Used !overide command', inline: true }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [embed] });

            // Store user connection
            userConnections.set(message.author.id, {
                epicUsername: result.username,
                accountId: result.accountId,
                method: 'override',
                verifiedAt: new Date()
            });

        } else {
            // Send error to user
            await message.author.send(`❌ VERIFICATION FAILED\n\nThe username "${fortniteUsername}" was not found.\nPlease check your spelling or make sure the account exists.`);

            // Send error to Fortnite channel
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ VERIFICATION FAILED')
                .setColor(0xFF0000)
                .addFields(
                    { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                    { name: '❌ Attempted Username', value: fortniteUsername, inline: true },
                    { name: '⚠️ Method', value: 'Used !overide command', inline: true },
                    { name: '📝 Status', value: 'Username not found', inline: false }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [errorEmbed] });
        }
    }
});

// Handle reactions to verification message
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // When we fetch partial messages
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
        try {
            // Send DM to user
            const dm = await user.send(`**Please type your Fortnite username.**\n\nPlease only write your Fortnite username in this DM otherwise you will not be added to the custom game.\n\nAlternatively if this doesn't work type \`!overide yourfortniteusername\`\n\nPlease note if this name is wrong you will not be added to the custom game.`);

            // Store user as pending verification
            pendingVerifications.set(user.id, {
                messageId: messageId,
                dmChannelId: dm.channel.id,
                startedAt: new Date()
            });

        } catch (error) {
            console.error('Could not send DM to user:', error);
            // Can't send DM, notify in original channel
            const originalChannel = await client.channels.fetch(verificationData.channelId);
            await originalChannel.send(`<@${user.id}> I couldn't send you a DM! Please make sure your DMs are open and try again.`);
        }
    }
});

// Handle DMs from users
client.on('messageCreate', async (message) => {
    // Only handle DMs (no guild = DM channel)
    if (message.guild || message.author.bot) return;

    const userData = pendingVerifications.get(message.author.id);
    if (userData) {
        const fortniteUsername = message.content.trim();
        
        // Verify the username
        const result = await verifyFortniteUsername(fortniteUsername);

        // Get the Fortnite channel
        const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);

        if (result.verified) {
            // Send success to user
            await message.author.send(`🎮 FORTNITE ACCOUNT VERIFIED\n🎯 Epic Games: ${result.username}`);

            // Send to Fortnite channel
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

            // Store user connection
            userConnections.set(message.author.id, {
                epicUsername: result.username,
                accountId: result.accountId,
                method: 'dm',
                verifiedAt: new Date()
            });

        } else {
            // Send error to user
            await message.author.send(`❌ VERIFICATION FAILED\n\nThe username "${fortniteUsername}" was not found.\nPlease check your spelling or make sure the account exists.`);

            // Send error to Fortnite channel
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ VERIFICATION FAILED')
                .setColor(0xFF0000)
                .addFields(
                    { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                    { name: '❌ Attempted Username', value: fortniteUsername, inline: true },
                    { name: '📝 Status', value: 'Username not found', inline: false }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [errorEmbed] });
        }

        // Clean up
        pendingVerifications.delete(message.author.id);
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
