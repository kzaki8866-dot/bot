require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- SERVER SETUP ---
const app = express();
app.get('/', (req, res) => res.send('dollhouse status: ELITE 🎀'));
app.listen(process.env.PORT || 10000);

// --- ADVANCED DATABASE ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    username: String,
    tier: { type: String, default: "stranger" }, 
    trustLevel: { type: Number, default: 0 },
    mood: { type: String, default: "shy" },
    memoryVault: { type: Array, default: [] },
    lastSeen: { type: Date, default: Date.now }
}));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ intents: [3276799] });

// --- THE MASTER BRAIN PROMPT ---
const SYSTEM_PROMPT = `you are a shy, vulgar teen comgirl. lowercase only. use stutters.
PHYSICS & RULES:
1. you are aware of time, channel names, and who is in VC.
2. update your mood/relationship using: [TIER: x], [TRUST: +/-x], [MOOD: x].
3. to send a visual, use [VISUAL: description]. NEVER send links.
4. use [JOIN_VC] if you want to follow the user into voice.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 NEURAL LINK ACTIVE"));

// --- HELPER: VOICE ENGINE ---
async function speak(guildId, text) {
    const connection = getVoiceConnection(guildId);
    if (!connection || !text) return;
    try {
        const cleanText = text.replace(/\[.*?\]/g, '').trim();
        if (!cleanText) return;
        const url = googleTTS.getAudioUrl(cleanText, { lang: 'en', slow: false });
        const player = createAudioPlayer();
        connection.subscribe(player);
        player.play(createAudioResource(url));
    } catch (e) { console.error("TTS Error:", e); }
}

// --- DEPLOYMENT TRIGGER ---
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} IS ONLINE`);
    client.user.setActivity('with ur heart', { type: ActivityType.Competing });
    
    // Auto-message first available channel on boot
    const channel = client.channels.cache.find(c => c.type === 0 && c.permissionsFor(client.user).has('SendMessages'));
    if (channel) {
        const bootImg = new AttachmentBuilder(`https://pollinations.ai/p/shy_anime_girl_waking_up_aesthetic?width=1024&height=1024&seed=${Math.random()}`, { name: 'boot.jpg' });
        channel.send({ content: "m-mm.. just woke up.. is anyone even there? 🐾", files: [bootImg] });
    }
});

// --- VC SITUATIONAL AWARENESS (Greets) ---
client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.member.user.bot) return;
    const connection = getVoiceConnection(newState.guild.id);
    if (connection && newState.channelId === connection.joinConfig.channelId && !oldState.channelId) {
        speak(newState.guild.id, `h-hey ${newState.member.displayName}.. why did u join me..?`);
    }
});

// --- MAIN CHAT ENGINE ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const isPinged = message.mentions.has(client.user);
    const triggerChance = Math.random() < 0.15; // 15% chance to "overhear" and respond
    if (!isPinged && !triggerChance) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id, username: message.author.username });

        // CONTEXTUAL PHYSICS
        const time = new Date().toLocaleTimeString();
        const vcMembers = message.member.voice.channel?.members.map(m => m.displayName).join(', ') || "none";
        
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ 
                role: "system", 
                content: `${SYSTEM_PROMPT} 
                CONTEXT: Time is ${time}. Channel is #${message.channel.name}. Users in VC: ${vcMembers}.
                USER DATA: ${userData.username} is your ${userData.tier}. Trust: ${userData.trustLevel}. Mood: ${userData.mood}.
                MEMORIES: ${userData.memoryVault.slice(-3).join(', ')}` 
            }, { 
                role: "user", 
                content: message.content 
            }],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = chatCompletion.choices[0].message.content.toLowerCase();
        let files = [];

        // 1. JOIN VC PHYSICS
        if (rawOutput.includes('[join_vc]')) {
            const channel = message.member.voice.channel;
            if (channel) {
                const conn = joinVoiceChannel({ channelId: channel.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
                await entersState(conn, VoiceConnectionStatus.Ready, 5000).catch(() => {});
            }
        }

        // 2. FIXED VISUAL INTERCEPTOR
        const visualMatch = rawOutput.match(/\[(?:visual|gif|image): (.*?)\]/i);
        if (visualMatch) {
            const query = visualMatch[1];
            files.push(new AttachmentBuilder(`https://pollinations.ai/p/${encodeURIComponent(query)}?width=1024&height=1024&seed=${Math.random()}`, { name: 'dollhouse.jpg' }));
        } else if (Math.random() < 0.05) { // 5% chance of random "mood" pic
            files.push(new AttachmentBuilder(`https://pollinations.ai/p/aesthetic_anime_vibes?seed=${Math.random()}`, { name: 'vibe.jpg' }));
        }

        // 3. DB UPDATES (TIER, TRUST, MOOD, MEMORY)
        const trustMatch = rawOutput.match(/\[trust: ([+-]\d+)\]/);
        if (trustMatch) userData.trustLevel += parseInt(trustMatch[1]);
        const tierMatch = rawOutput.match(/\[tier: (.*?)\]/);
        if (tierMatch) userData.tier = tierMatch[1];
        const moodMatch = rawOutput.match(/\[mood: (.*?)\]/);
        if (moodMatch) userData.mood = moodMatch[1];
        const saveMatch = rawOutput.match(/\[save: (.*?)\]/);
        if (saveMatch) userData.memoryVault.push(saveMatch[1]);
        
        userData.lastSeen = Date.now();
        await userData.save();

        // 4. FINAL CLEANUP & REPLY
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();
        await message.reply({ content: displayContent || 'm-mm..', files: files });
        speak(message.guild.id, displayContent);

    } catch (e) { console.error("Neural Error:", e); }
});

client.login(process.env.TOKEN);