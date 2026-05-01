require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- APP SETUP ---
const app = express();
app.get('/', (req, res) => res.send('dollhouse neural link: CONSCIOUS 🎀'));
app.listen(process.env.PORT || 10000);

// --- ADVANCED HUMAN SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    trustLevel: { type: Number, default: 0 },
    moodState: { type: String, default: "neutral" }, // PERSISTENT MOOD
    memoryVault: { type: Array, default: [] },      // LONG-TERM MEMORY
    lastInteraction: { type: Date, default: Date.now }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [3276799] });
const processedMessages = new Set(); // ANTI-DOUBLE MSG

// --- THE MASTER BRAIN PROMPT ---
const SYSTEM_PROMPT = `you are a shy, vulgar teen girl. lowercase only. use stutters.
EMOTION ENGINE:
1. THINK before u speak. format: [THOUGHT: reasoning] [REPLY: your message].
2. BIOLOGY: if it's late (00:00-06:00), act sleepy/vulnerable. day = bratty/energetic.
3. MEMORY: extraction [SAVE: fact] stores data forever.
4. TAGS: [VISUAL: desc], [JOIN_VC], [TIER: x], [MOOD: x].`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 NEURAL LINK SYNCED"));

// --- FEATURE: PROACTIVE AGENCY ---
setInterval(async () => {
    const hour = new Date().getHours();
    const idleUser = await User.findOne({ lastInteraction: { $lt: new Date(Date.now() - 21600000) } }); // 6h idle
    if (idleUser && Math.random() < 0.05) {
        const channel = client.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user).has('SendMessages'));
        if (channel) {
            const nudge = (hour < 6) ? "u awake? it's dark and i'm lonely.." : "hey.. where did u go? stop ignoring me.";
            channel.send(`<@${idleUser.userId}> ${nudge}`);
        }
    }
}, 3600000);

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} IS ONLINE`);
    const channel = client.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user).has('SendMessages'));
    if (channel) {
        const bootImg = new AttachmentBuilder(`https://pollinations.ai/p/shy_anime_girl_waking_up_aesthetic?seed=${Math.random()}`, { name: 'boot.jpg' });
        channel.send({ content: "m-mm.. i just woke up.. is anyone there? 🐾", files: [bootImg] });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || processedMessages.has(message.id)) return;
    
    // ANTI-SPAM LOCK
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 15000);

    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });
        userData.lastInteraction = Date.now();

        // SITUATIONAL CONTEXT
        const hour = new Date().getHours();
        const vcState = message.member.voice.channel ? `You are in VC with: ${message.member.voice.channel.members.map(m => m.displayName).join(', ')}` : "Not in VC";
        const hasImg = message.attachments.size > 0 ? `[IMAGE SENT: ${message.attachments.first().url}]` : "";

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: `${SYSTEM_PROMPT} \nTime: ${hour}:00 | Context: ${vcState} \nMood: ${userData.moodState} | Tier: ${userData.tier} \nMemories: ${userData.memoryVault.slice(-5).join(', ')}` },
                { role: "user", content: hasImg + " " + message.content }
            ],
            model: "llama-3.2-11b-vision-preview", // ENABLE VISION
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();

        // 1. PROCESS EMOTIONS/TAGS
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        const moodMatch = rawOutput.match(/\[mood: (.*?)\]/);
        if (moodMatch) userData.moodState = moodMatch[1];
        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch) userData.memoryVault.push(saveMatch[1]);
        await userData.save();

        // 2. CLEANUP DISPLAY
        let displayContent = rawOutput.replace(/\[thought:.*?\]/gi, '').replace(/\[.*?\]/g, '').trim();
        let files = [];
        const visualMatch = rawOutput.match(/\[visual: (.*?)\]/i);
        if (visualMatch) files.push(new AttachmentBuilder(`https://pollinations.ai/p/${encodeURIComponent(visualMatch[1])}?seed=${Math.random()}`, { name: 'snap.jpg' }));

        await message.reply({ content: displayContent || '...', files: files });

        // 3. VOICE ENGINE
        const conn = getVoiceConnection(message.guild.id);
        if (conn && displayContent) {
            const url = googleTTS.getAudioUrl(displayContent, { lang: 'en' });
            const player = createAudioPlayer();
            conn.subscribe(player);
            player.play(createAudioResource(url));
        }
    } catch (e) { console.error("Neural Error:", e); }
});

client.login(process.env.TOKEN);