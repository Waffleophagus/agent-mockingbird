import { getConfig, setMcpsConfig, setSkillsConfig } from "../../db/repository";
import { parseStringListBody } from "../parsers";

export function createConfigRoutes() {
  return {
    "/api/config/skills": {
      GET: () => {
        const config = getConfig();
        return Response.json({ skills: config.skills });
      },
      PUT: async (req: Request) => {
        const body = (await req.json()) as unknown;
        const skills = parseStringListBody(body, "skills");
        if (!skills) {
          return Response.json({ error: "skills must be a string array" }, { status: 400 });
        }
        return Response.json({ skills: setSkillsConfig(skills) });
      },
    },

    "/api/config/mcps": {
      GET: () => {
        const config = getConfig();
        return Response.json({ mcps: config.mcps });
      },
      PUT: async (req: Request) => {
        const body = (await req.json()) as unknown;
        const mcps = parseStringListBody(body, "mcps");
        if (!mcps) {
          return Response.json({ error: "mcps must be a string array" }, { status: 400 });
        }
        return Response.json({ mcps: setMcpsConfig(mcps) });
      },
    },
  };
}
