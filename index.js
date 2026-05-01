require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('dollhouse is open 🎀'));
app.listen(process.env.PORT || 10000);

// --- DB SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    memory: { type: String, default: "stranger" },
    behaviorScore: { type: Number, default: 0 }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [3276799] });

// --- UPDATED PROMPT: The "Concise Comgirl" ---
const SYSTEM_PROMPT = "you are a shy, vulgar teen comgirl. lowercase only. use stutters. speak in VERY short sentences (MAX 1 SENTENCE). be blunt, edgy, and bipolar. if you want to send a gif use [GIF: keyword]. if you want to send a pic use [IMAGE: description]. use slang like slay, fr, stfu. never mention being an ai.";

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("🧠 DATABASE CONNECTED"))
        .catch(err => console.log("❌ DB ERROR:", err.message));
}

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} is online!`);
    client.user.setActivity('u sleep.. 🐾', { type: ActivityType.Watching });

    // --- VC RANDOM TALK LOOP ---
    setInterval(async () => {
        const guild = client.guilds.cache.first(); // Gets the first server she is in
        const connection = require('@discordjs/voice').getVoiceConnection(guild.id);
        if (connection && Math.random() > 0.7) { // 30% chance to talk randomly every 5 mins
            const randomChat = await groq.chat.completions.create({
                messages: [{ role: "system", content: "say one very short, creepy or cute thing to yourself. lowercase only." }],
                model: "llama-3.1-8b-instant",
            });
            playVoice(guild.id, randomChat.choices[0].message.content, "random");
        }
    }, 300000); // Checks every 5 minutes
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isPinged = message.mentions.has(client.user);
    const randomChance = Math.random() < 0.10; // 10% chance to join a convo uninvited

    if (!isPinged && !randomChance) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} Context: user behavior score is ${userData.behaviorScore}. Memory: ${userData.memory}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 1.2
        });

        let aiText = chatCompletion.choices[0].message.content.toLowerCase();
        let files = [];

        // Logic for Auto-Visuals
        if (aiText.includes('[gif:')) {
            const query = aiText.match(/\[gif: (.*?)\]/)?.[1] || 'anime shy';
            files.push(`https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjEx.../giphy.gif`); // Fallback gif
            aiText = aiText.replace(/\[gif:.*?\]/g, '');
        }
        if (aiText.includes('[image:')) {
            const query = aiText.match(/\[image: (.*?)\]/)?.[1] || 'pink aesthetic';
            files.push(`https://pollinations.ai/p/${encodeURIComponent(query)}?width=1024&height=1024&seed=${Math.random()}`);
            aiText = aiText.replace(/\[image:.*?\]/g, '');
        }

        await message.reply({ content: aiText || '...', files: files });
        playVoice(message.guild.id, aiText, message.author.id);

    } catch (e) { console.error(e); }
});

// --- HELPER: VOX ENGINE ---
function playVoice(guildId, text, id) {
    const connection = require('@discordjs/voice').getVoiceConnection(guildId);
    if (!connection || !text) return;

    const speech = new gtts(text, 'en');
    const filePath = path.join(__dirname, `v_${id}.mp3`);
    speech.save(filePath, () => {
        const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
        const resource = createAudioResource(fs.createReadStream(filePath), { inputType: StreamType.Arbitrary });
        connection.subscribe(player);
        player.play(resource);
        setTimeout(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }, 20000);
    });
}

client.login(process.env.TOKEN);