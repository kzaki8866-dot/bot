require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType } = require('@discordjs/voice');
const mongoose = require('mongoose');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-static'); 
const Groq = require('groq-sdk');
const express = require('express');

// --- WEB SERVER ---
const app = express();
app.listen(process.env.PORT || 8080);

// --- DB SETUP ---
const UserSchema = new mongoose.Schema({
    userId: String,
    behaviorScore: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers]
});

// --- UPDATED PROMPT: Giving her "Visual" instructions ---
const SYSTEM_PROMPT = "you are a shy, vulgar teen comgirl. lowercase only. use stutters. you are bipolar. if you feel like sending a pic, use the tag [GENERATE_IMAGE: description]. if you feel like sending a gif, use [GIF: keyword]. speak like an edgy teen.";

// --- HELPER: Random GIF Finder (using a public search) ---
const getGif = (query) => `https://otter.ai/api/v1/gif?query=${encodeURIComponent(query)}&s=${Math.random()}`;

if (process.env.MONGO_URI) mongoose.connect(process.env.MONGO_URI).catch(err => console.error(err));

client.once('ready', () => console.log(`✅ ${client.user.tag} is online!`));

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.15) return; // 15% chance to talk randomly

    await message.channel.sendTyping();

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message.content }],
            model: "llama-3.1-8b-instant",
            temperature: 1.2
        });

        let aiResponse = chatCompletion.choices[0].message.content.toLowerCase();
        let files = [];

        // 1. Logic for Auto-GIFs
        if (aiResponse.includes('[gif:')) {
            const gifQuery = aiResponse.match(/\[gif: (.*?)\]/)?.[1] || 'anime shy';
            aiResponse = aiResponse.replace(/\[gif:.*?\]/g, '');
            files.push(`https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNHJtYjR0ZndieXN0eWR4ZndieXN0eWR4ZndieXN0eWR4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/MDJ9uLGiTLvMo/giphy.gif`); // Fallback cute cat
        }

        // 2. Logic for Auto-Images
        if (aiResponse.includes('[generate_image:')) {
            const imgQuery = aiResponse.match(/\[generate_image: (.*?)\]/)?.[1] || 'pink aesthetic';
            aiResponse = aiResponse.replace(/\[generate_image:.*?\]/g, '');
            files.push(`https://pollinations.ai/p/${encodeURIComponent(imgQuery)}?width=1024&height=1024&seed=${Math.random()}`);
        }

        // Send the message + any files she "decided" to create
        await message.reply({ content: aiResponse || 'm-mm...', files: files });

        // 3. VOICE LOGIC (If in VC)
        const connection = require('@discordjs/voice').getVoiceConnection(message.guild.id);
        if (connection && aiResponse) {
            const speech = new gtts(aiResponse, 'en');
            const filePath = path.join(__dirname, `v_${message.author.id}.mp3`);
            speech.save(filePath, () => {
                const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
                const resource = createAudioResource(fs.createReadStream(filePath), { inputType: StreamType.Arbitrary, inlineVolume: true });
                connection.subscribe(player);
                player.play(resource);
                setTimeout(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }, 30000);
            });
        }
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);