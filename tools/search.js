const axios = require('axios');
module.exports = {
    name: "web_search",
    description: "Search the internet for real-time info.",
    execute: async (query) => {
        const res = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
        const match = res.data.match(/<a class="result__snippet[^>]*>(.*?)<\/a>/i);
        return match ? match[1].replace(/<[^>]*>/g, "") : "No results.";
    }
};