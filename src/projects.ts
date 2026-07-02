export type Project = {
  id: string;
  name: string;
  aliases: string[];
};

export const PROJECTS: Project[] = [
  { id: "gpt", name: "GPT", aliases: ["Gerardo PT"] },
  { id: "fpt", name: "FPT", aliases: ["Francesco PT"] },
  { id: "og", name: "OG", aliases: ["OG Motors"] },
  { id: "ifo", name: "IFO", aliases: ["IFO Wellness Club"] },
  { id: "sofly", name: "SOFLY", aliases: ["Simple Operator Fly"] },
  { id: "mammma", name: "MAMMMA", aliases: ["MAMMMA", "MAMMMÀ"] },
  { id: "sidial", name: "SIDIAL", aliases: [] },
  { id: "general", name: "GENERAL", aliases: ["General Impresa"] },
  { id: "lt-finance", name: "LT FINANCE", aliases: [] },
  { id: "sol-gru", name: "SOL GRU", aliases: ["Sol Gru Martelli"] },
  { id: "manna", name: "MANNA", aliases: ["MANNA PUBBLICITÀ"] },
  { id: "lt", name: "LT", aliases: ["LT Consulting"] },
];

export function normalizeProjectName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("it-IT");
}

export function findProjectByName(value: string) {
  const normalizedValue = normalizeProjectName(value);

  return PROJECTS.find((project) => {
    const projectNames = [project.name, ...project.aliases];

    return projectNames.some(
      (projectName) => normalizeProjectName(projectName) === normalizedValue,
    );
  });
}
