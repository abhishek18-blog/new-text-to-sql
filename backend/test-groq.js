require("dotenv").config();
const { ChatGroq } = require("@langchain/groq");
const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0,
});
llm.invoke("Hello").then(console.log).catch(console.error);
