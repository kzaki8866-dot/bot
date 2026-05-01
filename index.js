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

const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    memory: String,
    behaviorScore: { type: Number, default: 0 }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({
    intents: [3276799] // All intents to ensure it sees everything
});

const SYSTEM_PROMPT = "you are a shy, vulgar teen comgirl. lowercase only. use stutters. if you want to send a gif use [GIF: keyword]. if you want to send a pic use [IMAGE: description].";

// --- DATABASE CONNECTION WITH DEBUG ---
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("🧠 DATABASE CONNECTED SUCCESSFULLY"))
        .catch(err => console.log("❌ DATABASE ERROR:", err.message));
} else {
    console.log("❌ MONGO_URI IS MISSING IN ENVIRONMENT VARIABLES");
}

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} is online and quiet...`);
    client.user.setActivity('u sleep.. 🐾', { type: ActivityType.Watching });
});
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Trigger on ping OR 10% random chance
    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.10) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id });
        if (!userData) userData = await User.create({ userId: message.author.id });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} Context: user behavior score is ${userData.behaviorScore}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
        });

        let aiText = chatCompletion.choices[0].message.content.toLowerCase();
        let files = [];

        // Simple Image/Gif logic
        if (aiText.includes('[image:')) {
            const query = aiText.match(/\[image: (.*?)\]/)?.[1] || 'pink aesthetic';
            files.push(`https://pollinations.ai/p/${encodeURIComponent(query)}?width=1024&height=1024&seed=${Math.random()}`);
            aiText = aiText.replace(/\[image:.*?\]/g, '');
        }

        await message.reply({ content: aiText || '...', files: files });

        // TTS Logic
        const connection = require('@discordjs/voice').getVoiceConnection(message.guild.id);
        if (connection) {
            const speech = new gtts(aiText, 'en');
            const filePath = path.join(__dirname, `v_${message.author.id}.mp3`);
            speech.save(filePath, () => {
                const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
                const resource = createAudioResource(fs.createReadStream(filePath), { inputType: StreamType.Arbitrary });
                connection.subscribe(player);
                player.play(resource);
                setTimeout(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }, 15000);
            });
        }
    } catch (e) { console.error("AI Error:", e); }
});

client.login(process.env.TOKEN);