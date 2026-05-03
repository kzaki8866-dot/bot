const mongoose = require('mongoose');

const VectorSchema = new mongoose.Schema({
    userId: String,
    core_identity: { type: String, default: "A mysterious user." },
    learned_facts: [String],
    interaction_count: { type: Number, default: 0 }
});
const Memory = mongoose.model('VectorMemory', VectorSchema);

module.exports = {
    async getMindset(userId) {
        const m = await Memory.findOne({ userId });
        return m ? `Identity: ${m.core_identity}\nFacts: ${m.learned_facts.slice(-10).join(', ')}` : "First meeting.";
    },
    async evolve(userId, newFact, newIdentity) {
        await Memory.findOneAndUpdate(
            { userId },
            { $push: { learned_facts: newFact }, $set: { core_identity: newIdentity }, $inc: { interaction_count: 1 } },
            { upsert: true }
        );
    }
};