const { ChatGroq } = require("@langchain/groq");

module.exports = class Manager {
    constructor(apiKey) {
        this.model = new ChatGroq({ apiKey, modelName: "llama-3.3-70b-versatile" });
    }

    async route(userInput, mindset) {
        const decisionPrompt = `
        You are the Neural Manager for a Government AI.
        User Input: "${userInput}"
        User History: ${mindset}

        Analyze the input. Does this require real-time facts from the internet?
        If YES, respond only with: REQUEST_SEARCH(query)
        If NO, respond only with: PROCESS_CONVERSATION
        `;

        const response = await this.model.invoke([["system", decisionPrompt]]);
        return response.content;
    }
};