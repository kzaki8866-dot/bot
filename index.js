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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  // Ignore other bots
  if (message.author.bot) return;

  // Only reply if the bot is @mentioned
  if (message.mentions.has(client.user)) {
    // Remove the @BotName ping from the text so the AI just reads the raw message
    const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();

    // If they just pinged without saying anything, don't respond
    if (!userMessage) return;

    // Show the "Bot is typing..." indicator in Discord
    await message.channel.sendTyping();

    try {
      // Send the message to Groq (Llama 3)
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        model: "llama3-8b-8192", // Fast, smart model perfect for chat
        temperature: 0.9,        // High temperature = more human/random
        max_tokens: 300          // Keeps responses from being too long
      });

      // Extract the text and send it to Discord
      const response = chatCompletion.choices[0]?.message?.content || "idk tbh";
      await message.reply(response.slice(0, 2000));

    } catch (error) {
      console.error("API Error:", error);
      // THE "NO CRASH" TRICK: If Groq rate limits you, say this instead of crashing
      await message.reply("my discord is lagging rn tbh, what did u say?");
    }
  }
});

// Start the bot using the Discord Token
client.login(process.env.DISCORD_TOKEN);