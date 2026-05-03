const mongoose = require('mongoose');

const MemorySchema = new mongoose.Schema({
    userId: String,
    facts: [String],
    summary: { type: String, default: "A new user I am just meeting." }
});
const UserMemory = mongoose.model('UserMemory', MemorySchema);

async function getUserContext(userId) {
    const memory = await UserMemory.findOne({ userId });
    if (!memory) return "No prior history.";
    return `Current Summary: ${memory.summary}\nSpecific Facts: ${memory.facts.slice(-5).join(', ')}`;
}

async function updateMemory(userId, newFact, newSummary) {
    await UserMemory.findOneAndUpdate(
        { userId },
        { 
            $push: { facts: newFact },
            $set: { summary: newSummary } 
        },
        { upsert: true }
    );
}

module.exports = { getUserContext, updateMemory };