"use server";

// 1. Remove ChatWatsonx and import ChatGroq
import { ChatGroq } from "@langchain/groq";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  mapStoredMessagesToChatMessages,
  StoredMessage,
} from "@langchain/core/messages";
import { execute, getSchema } from "./database";
import { SystemMessage } from "@langchain/core/messages";
export async function message(messages: StoredMessage[]) {
  const deserialized = mapStoredMessagesToChatMessages(messages);

  const schemaStr = await getSchema();

  const getFromDB = tool(
    async (input) => {
      if (input?.sql) {
        console.log({ sql: input.sql });

        try {
          const result = await execute(input.sql);
          return JSON.stringify(result, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          );
        } catch (e: any) {
          return `Error executing query: ${e.message}`;
        }
      }
      return null;
    },
    {
      name: "get_from_db",
      description: `Get data from a MySQL database.`,
      schema: z.object({
        sql: z
          .string()
          .describe(
            "MySQL query to get data from the database. Do not use generic table names, only use the tables provided in the schema."
          ),
      }),
    }
  );

  const agent = createReactAgent({
    llm: new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
      temperature: 0,
    }),
    tools: [getFromDB],
    messageModifier: new SystemMessage(`You are an expert MySQL database analyst. The database has the following schema:\n\n${schemaStr}\n\nAlways use the get_from_db tool to execute queries. Ensure your queries include LIMIT 100 unless a specific count is requested.`),
  });

  const response = await agent.invoke({
    messages: deserialized,
  }, { recursionLimit: 100 });

  return response.messages[response.messages.length - 1].content;
}