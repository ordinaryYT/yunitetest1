// bot-render-ready.js
const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();

// --- RENDER PORT OR LOCAL PORT ---
const port = process.env.PORT || 3000;

// --- MIDDLEWARE ---
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- ENV VARIABLES ---
const discordToken = process.env.DISCORD_TOKEN;
const epicClientId = process.env.EPIC_CLIENT_ID;
const epicClientSecret = process.env.EPIC_CLIENT_SECRET;
const channelId = process.env.DISCORD_CHANNEL_ID;

// --- DYNAMIC REDIRECT URI ---
const redirectUri = process.env.RENDER_EXTERNAL_URL 
  ? `${process.env.RENDER_EXTERNAL_URL}/callback` 
  : `http://localhost:${port}/callback`;

// --- COMMAND QUEUE FOR AHK ---
let commandQueue = [];

// --- DISCORD BOT ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`OAuth Redirect URI: ${redirectUri}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === '!addfriend') {
    if (!epicClientId || !epicClientSecret) {
      return message.reply('Epic OAuth not configured.');
    }

    const oauthUrl = `https://www.epicgames.com/id/authorize?client_id=${epicClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=basic_profile&state=${message.author.id}`;

    const embed = new EmbedBuilder()
      .setTitle('Add Fortnite Friend')
      .setDescription('Click below to log in with Epic Games and add your Fortnite account as a friend.')
      .setColor('#7289da');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Log in with Epic Games')
        .setStyle(ButtonStyle.Link)
        .setURL(oauthUrl)
    );

    await message.reply({ embeds: [embed], components: [row] });
  }
});

client.login(discordToken);

// --- OAUTH CALLBACK ---
app.get('/callback', async (req, res) => {
  const { code, state: discordId, error, error_description } = req.query;

  if (error) {
    console.error('OAuth error:', error, error_description);
    return res.send(`<h2>OAuth Error</h2><p>${error}: ${error_description || 'Unknown error'}</p>`);
  }

  if (!code || !discordId) return res.send('Missing code or Discord ID');

  try {
    // --- EXCHANGE CODE FOR ACCESS TOKEN ---
    const tokenResponse = await axios.post(
      'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: epicClientId,
        client_secret: epicClientSecret,
        redirect_uri: redirectUri
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    if (!accessToken) return res.send('Failed to get access token.');

    // --- FETCH EPIC ACCOUNT INFO ---
    const userResponse = await axios.get(
      'https://account-public-service-prod03.ol.epicgames.com/account/api/public/account',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const { displayName, id: epicId } = userResponse.data;

    if (!displayName) return res.send('Failed to get Epic username.');

    // --- SEND TO DISCORD CHANNEL ---
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.send(`New Fortnite friend request: **Username**: ${displayName}, **Epic ID**: ${epicId} (Discord ID: ${discordId})`);
    }

    // --- QUEUE COMMAND FOR AHK ---
    const cmd = `add-friend ${displayName}`;
    const botname = 'sigmafish69';
    const id = uuidv4();
    commandQueue.push({ id, botname, command: cmd });
    console.log('Queued command:', { id, botname, command: cmd });

    // --- NOTIFY DISCORD USER ---
    const user = await client.users.fetch(discordId).catch(() => null);
    if (user) await user.send(`Your Fortnite username (${displayName}) has been queued for a friend request on bot ${botname}.`);

    res.send(`
      <h2>Success!</h2>
      <p>Your Fortnite username (${displayName}) has been submitted.</p>
      <p>You will receive a confirmation in Discord.</p>
    `);
  } catch (err) {
    console.error('OAuth Callback Error:', err.response?.data || err.message);
    res.send(`<h2>Authentication Failed</h2><p>${err.response?.data?.error_description || err.message}</p>`);
  }
});

// --- AHK ENDPOINTS ---
app.get('/fetch-command', (req, res) => {
  if (commandQueue.length === 0) return res.json({});
  res.json(commandQueue[0]);
});

app.post('/ack-command', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('Missing id');
  commandQueue = commandQueue.filter(cmd => cmd.id !== id);
  res.send('Acknowledged');
});

// --- START SERVER ---
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Redirect URI: ${redirectUri}`);
});
