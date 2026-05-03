const mongoose = require('mongoose');

const VectorSchema = new mongoose.Schema({
    userId: String,
    core_identity: { type: String, default: "Subject identified. Initializing profile." },
    learned_facts: [String]
});
const Memory = mongoose.model('VectorMemory', VectorSchema);

module.exports = {
    async getMindset(userId) {
        try {
            const m = await Memory.findOne({ userId });
            return m ? `Identity: ${m.core_identity} | Intelligence: ${m.learned_facts.slice(-5).join(', ')}` : "Profile Empty.";
        } catch (e) {
            return "Memory Access Denied.";
        }
    },
    async evolve(userId, fact, identity) {
        try {
            await Memory.findOneAndUpdate(
                { userId },
                { $push: { learned_facts: fact }, $set: { core_identity: identity } },
                { upsert: true }
            );
            console.log(`[EVOLUTION] Brain updated for user ${userId}`);
        } catch (e) {
            console.error("Memory Storage Error:", e);
        }
    }
};