const { ChatGroq } = require("@langchain/groq");

module.exports = class Manager {
    constructor(apiKey) {
        this.model = new ChatGroq({ 
            apiKey: apiKey, 
            modelName: "llama-3.3-70b-versatile",
            model: "llama-3.3-70b-versatile" 
        });
    }

    async route(userInput, mindset) {
        const decisionPrompt = `
        You are the Neural Strategic Manager.
        User Input: "${userInput}"
        User Context: ${mindset}

        Task: Determine if external real-time intelligence is required.
        - If the user asks about current events, news, or facts you don't know: Respond ONLY with REQUEST_SEARCH(query)
        - If it is a standard conversation or personal question: Respond ONLY with PROCESS_CONVERSATION
        `;

        try {
            const response = await this.model.invoke([["system", decisionPrompt]]);
            return response.content;
        } catch (err) {
            console.error("Manager Routing Error:", err);
            return "PROCESS_CONVERSATION";
        }
    }
};