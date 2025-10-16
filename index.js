const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Environment variables
const discordToken = process.env.DISCORD_TOKEN;
const epicClientId = process.env.EPIC_CLIENT_ID;
const epicClientSecret = process.env.EPIC_CLIENT_SECRET;
const channelId = process.env.DISCORD_CHANNEL_ID;
const redirectUri = process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/callback` : `http://localhost:${port}/callback`;

// Command queue for AHK
let commandQueue = [];

// Discord Bot Setup
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
      return message.reply('Error: OAuth not configured. Contact the bot admin.');
    }

    // OAuth URL
    const oauthUrl = `https://www.epicgames.com/id/authorize?client_id=${epicClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=basic_profile+friends_list&state=${message.author.id}`;

    // Embed + Button
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

// OAuth Callback
app.get('/callback', async (req, res) => {
  const { code, state: discordId, error, error_description } = req.query;

  if (error) {
    console.error('OAuth Error:', error, error_description);
    return res.send(`<h2>OAuth Error</h2><p>${error}: ${error_description || 'Unknown error'}</p>`);
  }

  if (!code || !discordId) return res.send('Error: Missing code or Discord ID.');

  try {
    console.log(`Exchanging code for token (Discord ID: ${discordId})...`);

    // Token request (URL-encoded, correct Epic endpoint)
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

    // Get Epic user info
    const userResponse = await axios.get('https://account-public-service-prod03.ol.epicgames.com/account/api/public/account', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { displayName, id: epicId } = userResponse.data;

    if (!displayName) return res.send('Error: Could not retrieve Fortnite username.');

    // Send to Discord channel
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.send(`New Fortnite friend request: **Username**: ${displayName}, **Epic ID**: ${epicId} (from Discord ID: ${discordId})`);
    }

    // Queue command for AHK
    const cmd = `add-friend ${displayName}`;
    const botname = 'sigmafish69';
    const id = uuidv4();
    commandQueue.push({ id, botname, command: cmd });
    console.log('Queued command:', { id, botname, command: cmd });

    // Notify Discord user
    const user = await client.users.fetch(discordId).catch(() => null);
    if (user) await user.send(`Your Fortnite username (${displayName}) has been queued for a friend request on bot ${botname}.`);

    res.send(`
      <h2>Success!</h2>
      <p>Your Fortnite username (${displayName}) has been submitted.</p>
      <p>You will receive a confirmation in Discord.</p>
    `);

  } catch (err) {
    console.error('OAuth error:', err.response ? err.response.data : err.message);
    const errMsg = err.response?.data?.error_description || err.message || 'Failed to authenticate.';
    res.send(`<h2>Authentication Failed</h2><p>${errMsg}</p>`);
  }
});

// AHK Endpoints
app.get('/fetch-command', (req, res) => {
  if (commandQueue.length === 0) return res.json({});
  const command = commandQueue[0];
  res.json(command);
  console.log('Sent command to AHK:', command);
});

app.post('/ack-command', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('Missing id');
  commandQueue = commandQueue.filter(cmd => cmd.id !== id);
  console.log('Acknowledged command:', id);
  res.send('Acknowledged');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Redirect URI: ${redirectUri}`);
});
