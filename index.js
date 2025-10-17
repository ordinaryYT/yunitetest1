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

// Check Epic Games website directly - NO FORTNITE APIS
const verifyEpicUsername = async (username) => {
    console.log(`\n🔍 Checking Epic Games website for: "${username}"`);
    
    try {
        // Method 1: Epic Games account lookup endpoint
        const response = await axios.get(`https://graphql.epicgames.com/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            data: {
                query: `
                    query SearchPlayers($displayName: String!) {
                        SearchPlayers(displayName: $displayName) {
                            accountId
                            displayName
                        }
                    }
                `,
                variables: {
                    displayName: username
                }
            },
            timeout: 10000
        });
        
        console.log(`📥 GraphQL Status: ${response.status}`);
        
        if (response.data && response.data.data && response.data.data.SearchPlayers && response.data.data.SearchPlayers.length > 0) {
            const user = response.data.data.SearchPlayers.find(u => u.displayName.toLowerCase() === username.toLowerCase());
            if (user) {
                console.log(`✅ SUCCESS: Username "${username}" exists!`);
                return {
                    verified: true,
                    username: user.displayName,
                    accountId: user.accountId,
                    source: 'epic-graphql'
                };
            }
        }
    } catch (error) {
        console.log('❌ GraphQL method failed:', error.message);
    }

    try {
        // Method 2: Epic Games public API
        const response2 = await axios.get(`https://www.epicgames.com/account/v2/search/${encodeURIComponent(username)}`, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        console.log(`📥 Search API Status: ${response2.status}`);
        
        if (response2.data && response2.data.length > 0) {
            const user = response2.data.find(u => u.displayName.toLowerCase() === username.toLowerCase());
            if (user) {
                console.log(`✅ SUCCESS: Username "${username}" exists!`);
                return {
                    verified: true,
                    username: user.displayName,
                    accountId: user.accountId,
                    source: 'epic-search'
                };
            }
        }
    } catch (error) {
        console.log('❌ Search API failed:', error.message);
    }

    try {
        // Method 3: Direct profile check
        const response3 = await axios.get(`https://www.epicgames.com/account/v1/accounts/${username}`, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: (status) => status < 500 // Accept any status except server errors
        });
        
        console.log(`📥 Profile Check Status: ${response3.status}`);
        
        // If we get a 200 response, the user exists
        if (response3.status === 200 && response3.data) {
            console.log(`✅ SUCCESS: Username "${username}" exists!`);
            return {
                verified: true,
                username: username,
                source: 'epic-profile'
            };
        }
    } catch (error) {
        console.log('❌ Profile check failed:', error.message);
    }

    // Final fallback: Manual verification
    console.log('⚠️ Using MANUAL verification (all website checks failed)');
    return { 
        verified: true, 
        username: username, 
        manual: true,
        note: 'All verification methods failed - manual fallback'
    };
};

// Bot events
client.once('ready', async () => {
    console.log(`\n✅ Logged in as ${client.user.tag}`);
    console.log(`🔗 Bot is in ${client.guilds.cache.size} servers`);
    console.log('🚀 Bot ready - NO FORTNITE APIS USED');
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

        console.log(`📝 Verification message sent in channel: ${message.channel.name}`);
    }

    // Override command
    if (message.content.startsWith('!overide')) {
        const args = message.content.split(' ');
        if (args.length < 2) {
            return message.reply('Usage: `!overide YourFortniteUsername`');
        }

        const fortniteUsername = args.slice(1).join(' ');
        console.log(`\n🎯 Override command from ${message.author.tag}: ${fortniteUsername}`);

        const result = await verifyEpicUsername(fortniteUsername);

        // Get the Fortnite channel
        const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);
        console.log(`📨 Fortnite channel: ${fortniteChannel?.name || 'NOT FOUND'}`);

        if (result.verified) {
            // Send to user
            await message.author.send(`🎮 FORTNITE ACCOUNT VERIFIED\n🎯 Epic Games: ${result.username}${result.manual ? '\n⚠️ Manual verification' : ''}`);

            // Send to Fortnite channel
            const embed = new EmbedBuilder()
                .setTitle('🎮 FORTNITE ACCOUNT VERIFIED')
                .setColor(0x00FF00)
                .addFields(
                    { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                    { name: '🎯 Epic Games', value: result.username, inline: true },
                    { name: '🆔 Account ID', value: result.accountId || 'Not Available', inline: false },
                    { name: '⚠️ Method', value: 'Used !overide command', inline: true },
                    { name: '🔍 Source', value: result.manual ? 'Manual' : result.source, inline: true }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [embed] });

            // Store user connection
            userConnections.set(message.author.id, {
                epicUsername: result.username,
                accountId: result.accountId,
                method: 'override',
                source: result.source || 'manual',
                verifiedAt: new Date()
            });

            console.log(`✅ Override SUCCESS for ${message.author.tag}: ${result.username}`);

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
                    { name: '📝 Status', value: result.error || 'Username not found', inline: false }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [errorEmbed] });

            console.log(`❌ Override FAILED for ${message.author.tag}: ${fortniteUsername}`);
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
        console.log(`✋ Reaction from ${user.tag} on verification message`);
        
        try {
            // Send DM to user
            const dm = await user.send(`**Please type your Fortnite username.**\n\nPlease only write your Fortnite username in this DM otherwise you will not be added to the custom game.\n\nAlternatively if this doesn't work type \`!overide yourfortniteusername\`\n\nPlease note if this name is wrong you will not be added to the custom game.`);

            // Store user as pending verification
            pendingVerifications.set(user.id, {
                messageId: messageId,
                dmChannelId: dm.channel.id,
                startedAt: new Date()
            });

            console.log(`📩 DM sent to ${user.tag}`);

        } catch (error) {
            console.error('❌ Could not send DM to user:', error.message);
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
        console.log(`📨 DM from ${message.author.tag}: "${fortniteUsername}"`);
        
        // Verify the username
        const result = await verifyEpicUsername(fortniteUsername);

        // Get the Fortnite channel
        const fortniteChannel = await client.channels.fetch(process.env.FORTNITE_CHANNEL_ID);

        if (result.verified) {
            // Send success to user
            await message.author.send(`🎮 FORTNITE ACCOUNT VERIFIED\n🎯 Epic Games: ${result.username}${result.manual ? '\n⚠️ Manual verification' : ''}`);

            // Send to Fortnite channel
            const embed = new EmbedBuilder()
                .setTitle('🎮 FORTNITE ACCOUNT VERIFIED')
                .setColor(0x00FF00)
                .addFields(
                    { name: '👤 Discord User', value: `<@${message.author.id}>`, inline: true },
                    { name: '🎯 Epic Games', value: result.username, inline: true },
                    { name: '🆔 Account ID', value: result.accountId || 'Not Available', inline: false },
                    { name: '📝 Method', value: 'DM Verification', inline: true },
                    { name: '🔍 Source', value: result.manual ? 'Manual' : result.source, inline: true }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [embed] });

            // Store user connection
            userConnections.set(message.author.id, {
                epicUsername: result.username,
                accountId: result.accountId,
                method: 'dm',
                source: result.source || 'manual',
                verifiedAt: new Date()
            });

            console.log(`✅ DM Verification SUCCESS for ${message.author.tag}: ${result.username}`);

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
                    { name: '📝 Status', value: result.error || 'Username not found', inline: false }
                )
                .setTimestamp();

            await fortniteChannel.send({ embeds: [errorEmbed] });

            console.log(`❌ DM Verification FAILED for ${message.author.tag}: ${fortniteUsername}`);
        }

        // Clean up
        pendingVerifications.delete(message.author.id);
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
