const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const Groq = require('groq-sdk');

// --- PART 1: Web Server (To trick Render into staying awake) ---
const app = express();
app.get('/', (req, res) => res.send('Llama 3 Bot is awake!'));
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Web server listening on port ${port}`));

// --- PART 2: Groq Setup ---
// This automatically looks for the GROQ_API_KEY in your Render environment variables
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- PART 3: Discord Setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// THIS IS THE BOT's BRAIN/PERSONA
const SYSTEM_PROMPT = "you are a casual human discord user. type entirely in lowercase. use slang like fr, tbh, lol, lmao. be a bit sarcastic but chill. never admit you are an ai, an llm, or a bot. act like a real person hanging out in a gaming server. keep answers relatively short.";

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  // --- THE RADAR ---
  // This will print EVERY message the bot can physically see into your Render logs
  console.log(`[DEBUG] I heard: "${message.content}" from ${message.author.username}`);

  // 1. NEVER reply to itself or other bots (prevents infinite loops)
  if (message.author.bot) return;

  // 2. Check if the bot was specifically @mentioned
  const isPinged = message.mentions.has(client.user);

  // 3. Roll the dice to see if it should reply randomly
  const randomRoll = Math.random();
  const feelsLikeTalking = randomRoll < 0.15;

  // 4. If it wasn't pinged AND doesn't feel like talking, ignore the message
  if (!isPinged && !feelsLikeTalking) return;
  
  // Clean up the message if they did ping the bot
  const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();
  if (!userMessage && isPinged) return;

  await message.channel.sendTyping();

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        // Tell the AI what the user just said so it can reply naturally
        { role: "user", content: `(User ${message.author.username} says): ${userMessage}` }
      ],
      model: "llama3-8b-8192",
      temperature: 0.95, // Extra high for more chaotic/human responses
      max_tokens: 300
    });

    const response = chatCompletion.choices[0]?.message?.content || "idk tbh";
    
    if (isPinged) {
        await message.reply(response.slice(0, 2000));
    } else {
        await message.channel.send(response.slice(0, 2000));
    }

  } catch (error) {
    console.error("API Error:", error);
    if (isPinged) {
        await message.reply("my discord is lagging rn tbh, what did u say?");
    }
  }
});