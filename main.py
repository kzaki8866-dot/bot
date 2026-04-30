import discord
from discord.ext import commands
from flask import Flask
from threading import Thread
import os

# --- PART 1: THE WEB SERVER (To trick Render) ---
app = Flask('')

@app.route('/')
def home():
    return "Bot is awake!"

def run_web_server():
    # Render provides a PORT environment variable automatically
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

def keep_alive():
    t = Thread(target=run_web_server)
    t.start()

# --- PART 2: THE DISCORD BOT ---
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name}!')

@bot.command()
async def ping(ctx):
    await ctx.send("Pong! I'm running on Render 24/7.")

# --- PART 3: START EVERYTHING ---
if __name__ == "__main__":
    keep_alive() # Starts the web server
    token = os.environ.get("DISCORD_TOKEN")
    bot.run(token)