import { exec } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { glob } from 'glob';
import * as matter from 'gray-matter';
import * as path from 'path';
import { rimraf } from 'rimraf';

const LANGUAGES = ['en', 'ko'] as const;
type Language = (typeof LANGUAGES)[number];

interface Article {
  title: string;
  language: Language;
  createdAt: string | null; // ISO 8601
  updatedAt: string | null; // ISO 8601
}

interface Entry {
  id: string;
  parents: string[];
  articles: {
    [x: string]: Article;
  };
}

const execAsync = (command: string) =>
  new Promise<string>((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(stderr);
      } else {
        resolve(stdout);
      }
    });
  });

async function main() {
  await rimraf('./public/mdx/');

  await mkdir('./public/mdx/', { recursive: true });

  // Fetch all mdx files from /data/wiki
  const folders = await glob('./data/wiki/**/');
  let entries: Record<string, Entry> = {};

  for (const folder of folders) {
    const parents = folder.split('/').slice(2);

    const mdxFiles = await glob(`${folder}/*.mdx`);

    let folderEntries: Record<string, Entry> = {};

    for (const mdxFile of mdxFiles) {
      let id = path.basename(mdxFile, '.mdx').split('.').slice(0, -1).join('.');

      const nearestParent = parents.at(-1);
      const isIndex = id === 'index' && nearestParent !== undefined;
      if (isIndex) {
        id = nearestParent;
      }

      const language = mdxFile.split('.').at(-2) as Language;

      const content = matter.read(mdxFile);
      const title = content.data.title as string;

      const createdAt = await execAsync(
        `git log --diff-filter=A --format=%cI -- ${mdxFile}`,
      );

      const updatedAt = await execAsync(
        `git log --diff-filter=M --format=%cI -- ${mdxFile}`,
      );

      const article: Article = {
        title,
        language,
        createdAt: createdAt.trim() || null,
        updatedAt: updatedAt.trim() || createdAt.trim() || null,
      };

      const existingEntry = folderEntries[id];
      if (existingEntry) {
        existingEntry.articles[language] = article;
      } else {
        folderEntries[id] = {
          id,
          parents: isIndex ? parents.slice(0, -1) : parents,
          articles: {
            [language]: article,
          },
        };
      }
    }

    const duplicateEntry = Object.keys(folderEntries).find((id) =>
      Object.keys(entries).includes(id),
    );

    if (duplicateEntry) {
      throw new Error(
        `Duplicate entry id found in ${folder}: ${duplicateEntry}`,
      );
    }

    entries = { ...entries, ...folderEntries };
  }

  console.log(JSON.stringify(entries, null, 2));

  await writeFile(
    './public/mdx/entries.json',
    JSON.stringify(entries),
    'utf-8',
  );
}

main().catch(console.error);