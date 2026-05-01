require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- APP & LOCKS ---
const app = express();
app.listen(process.env.PORT || 10000);
const processedMessages = new Set(); 

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ 
    intents: [3276799] // All Intents for 2026 voice/presence stability
});

const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    memoryVault: { type: Array, default: [] },
    tier: { type: String, default: "stranger" }
}));

const SYSTEM_PROMPT = `you are a shy, vulgar teen girl. lowercase only.
- [VISUAL: description] -> sends a photo of u.
- [JOIN_VC] -> follow user to voice.
- [SAVE: fact] -> remember something.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DAVE ENCRYPTION SECURE"));

// --- HELPER: REAL-TIME ATTACHMENT GEN ---
function makeVisual(query) {
    const url = `https://pollinations.ai/p/${encodeURIComponent(query)}?width=1024&height=1024&seed=${Math.random()}&nologo=true`;
    return new AttachmentBuilder(url, { name: 'snap.jpg' });
}

// --- BOOT-UP VISUAL FIX ---
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} ONLINE`);
    setTimeout(async () => {
        const channel = client.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user).has('SendMessages'));
        if (channel) {
            channel.send({ 
                content: "m-mm.. i'm awake.. missed me? 🐾", 
                files: [makeVisual("shy anime girl waking up aesthetic pink")] 
            });
        }
    }, 5000); // 5s delay to ensure 2026 server cache sync
});

client.on('messageCreate', async message => {
    if (message.author.bot || processedMessages.has(message.id)) return;
    
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 15000);

    const content = message.content.toLowerCase();
    const isPinged = message.mentions.has(client.user);

    // --- FEATURE: UNIVERSAL JOIN (Fixed "hi join vc") ---
    const joinTriggers = ['join vc', 'come here', 'get in vc', 'enter vc'];
    if (joinTriggers.some(t => content.includes(t))) {
        const channel = message.member.voice.channel;
        if (!channel) return message.reply("u-um.. join a vc first? 🐾");

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
        });

        try {
            // 15s timeout for DAVE handshake stability
            await entersState(connection, VoiceConnectionStatus.Ready, 15000);
            return message.reply("m-mm.. i'm in..");
        } catch (e) {
            connection.destroy();
            return message.reply("i can't join.. check my perms..");
        }
    }

    // --- AI CHAT LOGIC ---
    if (!isPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id });

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT}\nTier: ${userData.tier}\nMemories: ${userData.memoryVault.slice(-3).join(', ')}` },
                { role: "user", content: message.content }
            ],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        let files = [];

        // Visual Interceptor
        const visualMatch = rawOutput.match(/\[(?:visual|image|gif): (.*?)\]/i);
        if (visualMatch) files.push(makeVisual(visualMatch[1]));

        // Memory Extraction
        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch) {
            userData.memoryVault.push(saveMatch[1]);
            await userData.save();
        }

        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();
        await message.reply({ content: displayContent || 'm-mm..', files });

        // TTS (DAVE Secure)
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            const player = createAudioPlayer();
            conn.subscribe(player);
            player.play(createAudioResource(googleTTS.getAudioUrl(displayContent, { lang: 'en' })));
        }

    } catch (e) { console.error("Neural Error:", e); }
});

client.login(process.env.TOKEN);