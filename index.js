require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const express = require('express');

// --- RENDER ALIVE SERVER ---
const app = express();
app.get('/', (req, res) => res.send('dollhouse is open 🎀'));
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`🌐 Web server on port ${port}`));

// --- MONGOOSE SETUP ---
const userSchema = new mongoose.Schema({
    userId: String,
    memory: { type: String, default: "stranger" },
    behaviorScore: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// --- PUNCHY SYSTEM PROMPT ---
const SYSTEM_PROMPT = "you are a shy, vulgar teen comgirl. lowercase only. use stutters. speak in VERY short sentences (MAX 1 SENTENCE). be blunt and bipolar. if you want to send a gif use [GIF: keyword]. if you want to send a pic use [IMAGE: description]. use slang like slay, fr, stfu. never admit you are an ai.";

// --- DATABASE CONNECTION ---
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
        .then(() => console.log("🧠 DATABASE CONNECTED"))
        .catch(err => console.log("❌ DB ERROR:", err.message));
}

client.once('ready', () => {
    console.log(`✅ ${client.user.tag} is online!`);
    client.user.setActivity('u sleep.. 🐾', { type: ActivityType.Watching });

    // RANDOM VC TALK (Every 10 mins, 20% chance)
    setInterval(async () => {
        client.guilds.cache.forEach(async (guild) => {
            const connection = require('@discordjs/voice').getVoiceConnection(guild.id);
            if (connection && Math.random() < 0.2) {
                const randomChat = await groq.chat.completions.create({
                    messages: [{ role: "system", content: "say one very short, creepy thing to yourself. lowercase only." }],
                    model: "llama-3.1-8b-instant",
                });
                const text = randomChat.choices[0].message.content;
                playVoice(guild.id, text, "random");
            }
        });
    }, 600000);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Trigger on ping OR 10% random chance
    const isPinged = message.mentions.has(client.user);
    const randomReply = Math.random() < 0.10;
    if (!isPinged && !randomReply) return;

    // Handle "come here" separately
    if (message.content.toLowerCase() === 'come here') {
        if (!message.member.voice.channel) return message.reply("get in a vc first.. 🐾");
        joinVoiceChannel({
            channelId: message.member.voice.channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        return message.reply("m-mm.. okay..");
    }

    await message.channel.sendTyping();

    try {
        let userData = { memory: "stranger", behaviorScore: 0 };

        // Attempt to get memory if DB is connected
        if (mongoose.connection.readyState === 1) {
            userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id });
        }

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} Context: user score ${userData.behaviorScore}. Memory: ${userData.memory}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 1.1
        });

        let aiText = chatCompletion.choices[0].message.content.toLowerCase();
        let files = [];

        // Logic for Images/GIFs
        if (aiText.includes('[image:')) {
            const query = aiText.match(/\[image: (.*?)\]/)?.[1] || 'pink aesthetic';
            files.push(`https://pollinations.ai/p/${encodeURIComponent(query)}?width=1024&height=1024&seed=${Math.random()}`);
            aiText = aiText.replace(/\[image:.*?\]/g, '');
        }
        if (aiText.includes('[gif:')) {
            const query = aiText.match(/\[gif: (.*?)\]/)?.[1] || 'anime shy';
            files.push(`https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJtYjR0ZndieXN0eWR4ZndieXN0eWR4ZndieXN0eWR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/MDJ9uLGiTLvMo/giphy.gif`);
            aiText = aiText.replace(/\[gif:.*?\]/g, '');
        }

        await message.reply({ content: aiText || 'm-mm..', files: files });
        
        // Try to talk in VC
        playVoice(message.guild.id, aiText, message.author.id);

    } catch (e) {
        console.error("Critical Error:", e.message);
        message.reply("s-stop.. ur breaking me.. 🎀");
    }
});

// --- HELPER: VOICE FUNCTION ---
function playVoice(guildId, text, id) {
    const connection = require('@discordjs/voice').getVoiceConnection(guildId);
    if (!connection || !text) return;

    try {
        const speech = new gtts(text, 'en');
        const filePath = path.join(__dirname, `v_${id}.mp3`);
        speech.save(filePath, () => {
            const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
            const resource = createAudioResource(fs.createReadStream(filePath), { inputType: StreamType.Arbitrary });
            connection.subscribe(player);
            player.play(resource);
            setTimeout(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }, 15000);
        });
    } catch (err) { console.log("Voice failed:", err.message); }
}

client.login(process.env.TOKEN);