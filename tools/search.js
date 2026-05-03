const axios = require('axios');

// A brand new skill! She can now search the internet for real-time data.
module.exports = {
    definition: {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the internet for real-time facts, news, or data you do not know.",
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
        }
    },
    async execute(args) {
        try {
            // Using DuckDuckGo's free HTML search as a lightweight web scraper
            const res = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`);
            const snippet = res.data.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/i);
            if (snippet && snippet[1]) {
                // Strip HTML tags
                return `Search result: ${snippet[1].replace(/<\/?[^>]+(>|$)/g, "")}`;
            }
            return "No clear answers found on the web.";
        } catch (e) {
            return "Web search failed.";
        }
    }
};