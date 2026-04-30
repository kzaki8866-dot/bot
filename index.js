const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const app = express();

// --- PART 1: THE WEB SERVER (To trick Render) ---
app.get('/', (req, res) => {
  res.send('Node.js Bot is awake!');
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});

// --- PART 2: THE DISCORD BOT ---
// Setup permissions (Intents)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', message => {
  // Ignore other bots
  if (message.author.bot) return;

  if (message.content === '!ping') {
    message.reply('Pong! I am running on Node.js on Render 24/7.');
  }
});

// --- PART 3: START EVERYTHING ---
client.login(process.env.DISCORD_TOKEN);