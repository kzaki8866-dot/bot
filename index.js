require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnectionStatus, entersState, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const mongoose = require('mongoose');
const axios = require('axios'); // <-- NEW: Replaces Google TTS
const Groq = require('groq-sdk');
const express = require('express');
const ffmpegPath = require('ffmpeg-static');

// --- WEB SERVER ---
const app = express();
app.listen(process.env.PORT || 10000);

// --- GLOBAL PLAYER ---
const processedMessages = new Set(); 
const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 250, 
    },
});

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
    memoryVault: { type: Array, default: [] }
}));

const SYSTEM_PROMPT = `you are 'mommy'. you are a shy, protective, and sweet teen girl. lowercase only.
be conversational, emotionally intelligent, and natural. do not act like a robot.
AI INTENTS:
- [GIF: category] -> sends a gif. (blush, cry, hug, pat, smile, waifu)
- [JOIN_VC] -> follow user to voice.
keep responses concise but affectionate.`;

mongoose.connect(process.env.MONGO_URI).then(() => console.log("🧠 DB CONNECTED"));

// GIF API
async function fetchGifEmbed(category, textContent) {
    try {
        const validCategories = ['blush', 'cry', 'hug', 'pat', 'smile', 'waifu'];
        const safeCategory = validCategories.includes(category) ? category : 'waifu';
        const response = await fetch(`https://api.waifu.pics/sfw/${safeCategory}`);
        const data = await response.json();

        return new EmbedBuilder()
            .setColor('#FFB6C1') 
            .setDescription(textContent || "m-mm..")
            .setImage(data.url); 
    } catch (e) { return null; }
}

// --- VOICE EVENTS ---
player.on(AudioPlayerStatus.Playing, () => console.log("🔊 ElevenLabs Stream Playing..."));
player.on(AudioPlayerStatus.Idle, () => console.log("🔊 Audio finished."));
player.on('error', e => console.error("🔊 Audio Error:", e.message));

client.once(Events.ClientReady, (readyClient) => console.log(`✅ ${readyClient.user.tag} IS LIVE`));

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 20000); 

    const content = message.content.toLowerCase();
    const isPinged = message.mentions.users.has(client.user.id);

    if (!isPinged && Math.random() > 0.05) return;

    // VC JOIN LOGIC
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

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
            } catch (error) { connection.destroy(); }
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20000);
            connection.subscribe(player);
            return message.reply("m-mm.. i'm here.. i'll stay..");
        } catch (e) {
            connection.destroy();
            return message.reply("my network is too weak to join..");
        }
    }

    await message.channel.sendTyping();

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: message.content }],
            model: "llama-3.3-70b-versatile", 
            temperature: 0.75,
            max_tokens: 250 
        });

        let rawOutput = completion.choices[0].message.content.toLowerCase();
        let displayContent = rawOutput.replace(/\[.*?\]/g, '').trim();

        // Visuals
        const gifMatch = rawOutput.match(/\[gif: (.*?)\]/i);
        if (gifMatch) {
            const embed = await fetchGifEmbed(gifMatch[1], displayContent);
            if (embed) await message.reply({ embeds: [embed] });
            else await message.reply(displayContent || 'm-mm..');
        } else {
            await message.reply(displayContent || 'm-mm..');
        }

        // --- THE ELEVENLABS STREAM FIX ---
        const connection = getVoiceConnection(message.guild.id);
        if (connection && displayContent) {
            // Strip emojis to keep TTS clean
            let safeText = displayContent.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
            
            if (safeText.length > 0 && process.env.ELEVENLABS_API_KEY) {
                try {
                    const response = await axios({
                        method: 'POST',
                        url: `https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL/stream`, // 'Bella' Voice
                        data: {
                            text: safeText,
                            model_id: "eleven_monolingual_v1",
                            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                        },
                        headers: {
                            'Accept': 'audio/mpeg',
                            'xi-api-key': process.env.ELEVENLABS_API_KEY,
                            'Content-Type': 'application/json',
                        },
                        responseType: 'stream' // Super fast live-streaming
                    });

                    // Pass the live stream directly to Discord
                    const resource = createAudioResource(response.data, { inlineVolume: true });
                    resource.volume.setVolume(1.0);
                    player.play(resource);
                } catch (ttsError) {
                    console.error("🛑 ElevenLabs Error:", ttsError.response?.data || ttsError.message);
                }
            }
        }

    } catch (e) { 
        console.error("🛑 API Error:", e.message);
        if (e.status === 429) message.reply("m-my head hurts.. (api limit) 🐾");
    }
});

client.login(process.env.TOKEN);