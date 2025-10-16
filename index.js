const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Epic Games OAuth Configuration
const EPIC_CONFIG = {
    clientId: process.env.EPIC_CLIENT_ID,
    clientSecret: process.env.EPIC_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI,
    authUrl: 'https://www.epicgames.com/id/authorize',
    tokenUrl: 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token',
    userInfoUrl: 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/verify',
    fortniteServiceUrl: 'https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api'
};

// Store temporary data (use a database in production)
const pendingAuths = new Map();
const userConnections = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth callback endpoint
app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code || !state) {
        return res.status(400).send('Missing authorization code or state');
    }

    try {
        // Get access token
        const tokenResponse = await axios.post(EPIC_CONFIG.tokenUrl, 
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: EPIC_CONFIG.redirectUri
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${EPIC_CONFIG.clientId}:${EPIC_CONFIG.clientSecret}`).toString('base64')}`
                }
            });

        const accessToken = tokenResponse.data.access_token;

        // Get user info
        const userResponse = await axios.get(EPIC_CONFIG.userInfoUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const userInfo = userResponse.data;
        
        // Get Fortnite account info
        const fortniteResponse = await axios.get(
            `${EPIC_CONFIG.fortniteServiceUrl}/game/v2/profile/${userInfo.accountId}/client/QueryProfile?profileId=athena`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );

        const fortniteData = fortniteResponse.data;

        // Get pending auth data
        const authData = pendingAuths.get(state);
        if (!authData) {
            return res.status(400).send('Invalid state parameter');
        }

        const { userId, channelId } = authData;

        // Store user connection
        userConnections.set(userId, {
            epicUsername: userInfo.displayName,
            fortniteAccountId: userInfo.accountId,
            lastUpdated: new Date()
        });

        // Send to Discord channel
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🎮 Fortnite Username Connected')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Discord User', value: `<@${userId}>`, inline: true },
                    { name: 'Epic Games Username', value: userInfo.displayName, inline: true },
                    { name: 'Account ID', value: userInfo.accountId, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'Fortnite Verification Bot' });

            await channel.send({ embeds: [embed] });
        }

        // Clean up
        pendingAuths.delete(state);

        res.send(`
            <html>
                <body>
                    <h2>Successfully connected Fortnite account!</h2>
                    <p>You can now return to Discord.</p>
                    <script>
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
            </html>
        `);

    } catch (error) {
        console.error('OAuth callback error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// Bot commands
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🌐 OAuth server running on port ${PORT}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Set Fortnite channel command
    if (message.content.startsWith('!setfortnitechannel')) {
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.reply('❌ You need administrator permissions to use this command.');
        }

        process.env.FORTNITE_CHANNEL_ID = message.channel.id;
        await message.reply('✅ This channel has been set as the Fortnite username channel!');
    }

    // Connect Fortnite account command
    if (message.content.startsWith('!connectfortnite')) {
        const state = Math.random().toString(36).substring(7);
        
        // Store pending authentication
        pendingAuths.set(state, {
            userId: message.author.id,
            channelId: process.env.FORTNITE_CHANNEL_ID || message.channel.id
        });

        const authUrl = `${EPIC_CONFIG.authUrl}?client_id=${EPIC_CONFIG.clientId}&response_type=code&redirect_uri=${encodeURIComponent(EPIC_CONFIG.redirectUri)}&state=${state}&scope=basic_profile+friends_list+openid+fortnite`;

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Connect Epic Games Account')
                    .setStyle(ButtonStyle.Link)
                    .setURL(authUrl)
            );

        const embed = new EmbedBuilder()
            .setTitle('🔗 Connect Fortnite Account')
            .setDescription('Click the button below to connect your Epic Games/Fortnite account. This will share your Fortnite username with the server.')
            .setColor(0x0099FF);

        await message.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });
    }

    // Check connected users command
    if (message.content.startsWith('!fortniteusers')) {
        if (userConnections.size === 0) {
            return message.reply('No Fortnite accounts connected yet.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 Connected Fortnite Accounts')
            .setColor(0x0099FF);

        let description = '';
        userConnections.forEach((data, userId) => {
            description += `• <@${userId}> - **${data.epicUsername}**\n`;
        });

        embed.setDescription(description);
        await message.reply({ embeds: [embed] });
    }
});

// Start servers
app.listen(PORT, () => {
    console.log(`OAuth callback server started on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
