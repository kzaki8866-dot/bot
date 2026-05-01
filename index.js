require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const mongoose = require('mongoose');
const googleTTS = require('google-tts-api');
const Groq = require('groq-sdk');
const express = require('express');

// --- 1. LIGHTWEIGHT SERVER ---
const app = express();
app.listen(process.env.PORT || 10000);

// --- 2. STABILITY LOCKS & GLOBAL PLAYER ---
const processedMessages = new Set(); 
const player = createAudioPlayer(); // Global player saves RAM

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// --- 3. DATABASE ---
const User = mongoose.model('User', new mongoose.Schema({
    userId: String,
    memoryVault: { type: Array, default: [] }
}));

const SYSTEM_PROMPT = `you are 'mommy'. shy, protective teen girl. lowercase only.
AI INTENTS & RULES:
- [INTENT: VISUAL] description -> sends a photo or gif of what u are doing.
- [INTENT: JOIN_VC] -> follow user to voice.
- [INTENT: SAVE] fact -> remember something forever.
keep responses under 3 sentences to save energy.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB CONNECTED (LITE MODE)"));

// --- 4. THE VISUAL FIX: BUFFER UPLOADS ---
// Instead of sending a URL that Discord might block, we download the image bytes directly.
async function fetchVisualBuffer(query) {
    try {
        const url = `https://pollinations.ai/p/${encodeURIComponent(query)}?width=800&height=800&seed=${Math.random()}&nologo=true`;
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // We upload the raw file data to Discord
        return new AttachmentBuilder(buffer, { name: 'mommy_media.jpg' });
    } catch (e) {
        console.error("Image Fetch Error:", e.message);
        return null;
    }
}

// --- 5. VOICE EVENTS ---
player.on(AudioPlayerStatus.Idle, () => console.log("🔊 TTS finished playing."));
player.on('error', e => console.error("🔊 Audio Error:", e.message));

client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ ${readyClient.user.tag} IS LIVE`);
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    // ANTI-SPAM
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 20000); 

    const content = message.content.toLowerCase();
    const isPinged = message.mentions.users.has(client.user.id);

    // --- 6. TRIGGER LOGIC (100% Ping, 5% Random) ---
    // If she is NOT pinged, she rolls a 20-sided die. If it's not a 1 (5%), she ignores the message.
    if (!isPinged && Math.random() > 0.05) return;

    // --- 7. VC JOIN FIX ---
    const joinTriggers = ['join vc', 'come here', 'mommy join'];
    if (joinTriggers.some(t => content.includes(t))) {
        const channel = message.member.voice.channel;
        if (!channel) return message.reply("u-um.. u need to be in a vc first.. 🐾");

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            connection.subscribe(player);
            return message.reply("m-mm.. i'm here.. don't yell at me..");
        } catch (e) {
            connection.destroy();
            return message.reply("my connection failed.. sorry..");
        }
    }

    await message.channel.sendTyping();

    try {
        // --- 8. AI GENERATION (Low-Resource Model) ---
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message.content }],
            model: "llama-3.1-8b-instant", // Fastest, least likely to 429 rate-limit
            temperature: 0.7,
            max_tokens: 120 // Saves Groq API limits on free tier
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        // --- 9. BUFFER VISUAL EXTRACTION ---
        let files = [];
        const visualMatch = rawOutput.match(/\[intent: visual\] (.*?)(?=\[|$)/i) || rawOutput.match(/\[(?:visual|gif|image): (.*?)\]/i);
        
        if (visualMatch) {
            const attachment = await fetchVisualBuffer(visualMatch[1]);
            if (attachment) files.push(attachment);
        }

        // Send Text + Buffer Image
        await message.reply({ content: displayContent || 'm-mm..', files });

        // --- 10. SAFE TTS ---
        const connection = getVoiceConnection(message.guild.id);
        if (connection && displayContent) {
            let safeText = displayContent.length > 190 ? displayContent.substring(0, 190) + "..." : displayContent;
            try {
                const url = googleTTS.getAudioUrl(safeText, { lang: 'en', slow: false });
                player.play(createAudioResource(url));
            } catch (ttsError) { console.error("TTS Error:", ttsError.message); }
        }

    } catch (e) { 
        console.error("🛑 API Error:", e.message);
        if (e.status === 429) message.reply("m-my brain is overwhelmed.. (rate limited) 🐾");
    }
});

client.login(process.env.TOKEN);