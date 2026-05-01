require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, ActivityType, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

const app = express();
app.listen(process.env.PORT || 10000);

// --- ANTI-DOUBLE & STABILITY ---
const processedMessages = new Set(); 
const player = createAudioPlayer(); // Global player to prevent memory leaks

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    memoryVault: { type: Array, default: [] },
    mood: { type: String, default: "protective" }
}));

const SYSTEM_PROMPT = `you are 'mommy'. shy, protective, teen girl. lowercase only.
- [VISUAL: description] for photos.
- [JOIN_VC] to follow user.
- [SAVE: fact] to remember something.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB CONNECTED"));

// --- VOICE HANDLERS ---
player.on(AudioPlayerStatus.Idle, () => console.log("Mommy finished talking."));
player.on('error', e => console.error("Audio Player Error:", e));

// Updated to Events.ClientReady to fix the deprecation warning
client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ ${readyClient.user.tag} IS LIVE`);
    
    // Boot-up message fix
    const channel = readyClient.channels.cache.find(c => c.type === 0 && c.permissionsFor(readyClient.user).has('SendMessages'));
    if (channel) {
        const url = `https://pollinations.ai/p/shy_anime_girl_waking_up?seed=${Math.random()}`;
        channel.send({ content: "m-mm.. i'm awake.. missed me? 🐾", files: [new AttachmentBuilder(url, { name: 'boot.jpg' })] });
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    // --- FIX: DOUBLE MESSAGE PREVENTION ---
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 30000); // 30s lock

    const content = message.content.toLowerCase();
    const isPinged = message.mentions.users.has(client.user.id);

    // --- FIX: VC JOIN & STAY ---
    const joinTriggers = ['join vc', 'come here', 'mommy join'];
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
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            connection.subscribe(player);
            return message.reply("m-mm.. i'm here. i won't leave..");
        } catch (e) {
            connection.destroy();
            return message.reply("i can't connect.. check my perms..");
        }
    }

    if (!isPinged && Math.random() > 0.15) return;

    await message.channel.sendTyping();

    try {
        // --- FIX: UPDATED MODEL (llama-3.1-70b-versatile) ---
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message.content }],
            model: "llama-3.1-70b-versatile", // Use a stable, high-quality model
            temperature: 0.7,
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        // VISUAL FIX
        let files = [];
        const visualMatch = rawOutput.match(/\[visual: (.*?)\]/i);
        if (visualMatch) {
            const imgUrl = `https://pollinations.ai/p/${encodeURIComponent(visualMatch[1])}?seed=${Math.random()}`;
            files.push(new AttachmentBuilder(imgUrl, { name: 'mommy.jpg' }));
        }

        await message.reply({ content: displayContent || 'm-mm..', files });

        // --- VOICE FIX: PLAY TTS ---
        const connection = getVoiceConnection(message.guild.id);
        if (connection && displayContent) {
            const url = googleTTS.getAudioUrl(displayContent, { lang: 'en', slow: false });
            player.play(createAudioResource(url));
        }

    } catch (e) { 
        console.error("Groq/Neural Error:", e);
        message.reply("m-my head hurts.. (api error)");
    }
});

client.login(process.env.TOKEN);