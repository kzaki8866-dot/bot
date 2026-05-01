require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- PREVENT DOUBLING ---
const processedMessages = new Set(); 

const app = express();
app.listen(process.env.PORT || 10000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ] 
});

const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    tier: { type: String, default: "stranger" },
    memoryVault: { type: Array, default: [] }
}));

const SYSTEM_PROMPT = `you are a shy teen girl. lowercase only. use stutters.
use [VISUAL: description] to show yourself.
use [JOIN_VC] to follow the user into voice.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 NEURAL LINK READY"));

// --- FIXED BOOT-UP VISUAL ---
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} IS ONLINE`);
    
    // Give Discord a second to cache everything
    setTimeout(async () => {
        // Find a text channel where the bot can actually speak
        const channel = client.channels.cache.find(c => 
            c.type === 0 && 
            c.permissionsFor(client.user).has('SendMessages') &&
            c.permissionsFor(client.user).has('ViewChannel')
        );

        if (channel) {
            try {
                const bootImg = new AttachmentBuilder(`https://pollinations.ai/p/shy_anime_girl_waking_up_aesthetic?width=1024&height=1024&seed=${Math.random()}`, { name: 'boot.jpg' });
                await channel.send({ 
                    content: "m-mm.. just woke up.. did u miss me? 🐾", 
                    files: [bootImg] 
                });
                console.log("✨ Boot visual sent successfully");
            } catch (err) {
                console.error("❌ Failed to send boot visual:", err);
            }
        } else {
            console.warn("⚠️ Could not find a suitable channel to send the boot message.");
        }
    }, 3000); // 3-second delay to ensure cache is ready
});

// --- MAIN CHAT ENGINE (Anti-Spam Fixed) ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // PREVENT DOUBLE PROCESSING
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 15000); // 15s lock

    const isPinged = message.mentions.has(client.user);
    if (!isPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        let userData = await User.findOne({ userId: message.author.id }) || await User.create({ userId: message.author.id });

        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message.content }],
            model: "llama-3.1-8b-instant",
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        
        // 1. DYNAMIC VC JOIN
        if (rawOutput.includes('[join_vc]')) {
            const vc = message.member.voice.channel;
            if (vc) joinVoiceChannel({ channelId: vc.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        // 2. VISUAL INTERCEPTOR
        let files = [];
        const visualMatch = rawOutput.match(/\[visual: (.*?)\]/i);
        if (visualMatch) {
            files.push(new AttachmentBuilder(`https://pollinations.ai/p/${encodeURIComponent(visualMatch[1])}?seed=${Math.random()}`, { name: 'snap.jpg' }));
        }

        // 3. CLEAN & REPLY
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();
        await message.reply({ content: displayContent || 'm-mm..', files: files });

        // 4. TTS
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