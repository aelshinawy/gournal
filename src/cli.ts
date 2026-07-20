#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { readEntries, writeEntries } from './storage';
import { getProjectName } from './git';
import { generateStandupReport } from './report';
import { generateWorkLog } from './log';
import { generateStats, countBy } from './stats';
import { generateCsvExport, generateMarkdownExport } from './export';
import { startMcpServer } from './mcp';
import { filterByProject, filterByTags } from './util/entries.util';
import type { Entry } from './types';
import { format } from 'date-fns';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';

const { version } = fs.readJsonSync(path.join(__dirname, '..', 'package.json'));

const program = new Command();

program
  .name('gournal')
  .description('CLI development journal with Git integration')
  .version(version);

program
  .command('add <message>')
  .description('Add a new journal entry')
  .option('-t, --tags <tags>', 'Comma-separated tags', '')
  .action(async (message: string, { tags }: { tags: string }) => {
    const entry: Entry = {
      timestamp: new Date().toISOString(),
      message,
      project: getProjectName(),
      tags: tags.split(',').filter(Boolean),
    };
    
    const entries = await readEntries();
    entries.push(entry);
    await writeEntries(entries);
    console.log(chalk.green('✓ Entry added!'));
  });

  program
    .command('clear')
    .description('Clear all journal entries')
    .action(async () => {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: chalk.red(`Are you sure you want to clear all gournal entries?`),
          default: true,
        },
      ]);
      if (!confirm) return;
      await writeEntries([]);
      console.log(chalk.green('✓ Entries cleared!'));
    });

  program
    .command('undo')
    .description('Remove the most recently added journal entry')
    .action(async () => {
      const entries = await readEntries();
      if (entries.length === 0) {
        console.log(chalk.yellow('No entries to undo.'));
        return;
      }
      const removed = entries.pop()!;
      await writeEntries(entries);
      console.log(chalk.green(`✓ Removed: ${removed.message}`));
    });

  program
  .command('standup')
  .description('Generate standup report')
  .option('-y, --yesterday', 'Include yesterday\'s entries')
  .option('-w, --week', 'Show weekly summary')
  .option('-m, --month', 'Show monthly summary')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (options) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
    console.log(generateStandupReport(entries, options));
  });

program
  .command('log')
  .description('Show a chronological work log, grouped by day (today by default)')
  .option('-y, --yesterday', 'Include yesterday\'s entries')
  .option('-w, --week', 'Show weekly log')
  .option('-m, --month', 'Show monthly log')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (options) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
    console.log(generateWorkLog(entries, options));
  });

program
  .command('stats')
  .description('Show entry counts by project/tag and your current daily streak')
  .option('-p, --project <project>', 'Filter by project name')
  .action(async (options) => {
    const entries = filterByProject(await readEntries(), options.project);
    console.log(generateStats(entries));
  });

program
  .command('tags')
  .description('List distinct tags with entry counts')
  .action(async () => {
    const entries = await readEntries();
    const counts = countBy(entries.flatMap(e => e.tags));
    if (counts.length === 0) {
      console.log(chalk.yellow('No tags found.'));
      return;
    }
    counts.forEach(([tag, count]) => console.log(`${chalk.magenta(`#${tag}`)}  ${count}`));
  });

program
  .command('projects')
  .description('List distinct projects with entry counts')
  .action(async () => {
    const entries = await readEntries();
    const counts = countBy(entries.map(e => e.project));
    if (counts.length === 0) {
      console.log(chalk.yellow('No projects found.'));
      return;
    }
    counts.forEach(([project, count]) => console.log(`${chalk.blue(project)}  ${count}`));
  });

program
  .command('export')
  .description('Export journal entries to Markdown or CSV')
  .option('-f, --format <format>', 'Output format: md or csv', 'md')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-o, --output <file>', 'Write to a file instead of stdout')
  .action(async (options: { format: string; project?: string; tags?: string; output?: string }) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);

    const exportFormat = options.format.toLowerCase();
    if (exportFormat !== 'md' && exportFormat !== 'csv') {
      console.log(chalk.red(`Unknown format "${options.format}". Use "md" or "csv".`));
      return;
    }

    const output = exportFormat === 'csv' ? generateCsvExport(entries) : generateMarkdownExport(entries);

    if (options.output) {
      await fs.writeFile(options.output, output);
      console.log(chalk.green(`✓ Exported ${entries.length} entries to ${options.output}`));
    } else {
      console.log(output);
    }
  });

program
  .command('find <query>')
  .description('Find entries by keyword')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('--from <date>', 'ISO date lower bound (inclusive)')
  .option('--to <date>', 'ISO date upper bound (inclusive)')
  .action(async (query: string, options: { project?: string; tags?: string; from?: string; to?: string }) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
    if (options.from) entries = entries.filter(e => e.timestamp >= options.from!);
    if (options.to) entries = entries.filter(e => e.timestamp <= options.to!);

    const results = entries.filter(entry => entry.message.toLowerCase().includes(query.toLowerCase()));

    console.log(chalk.bold(`Found ${results.length} entries:\n`));
    results.forEach(entry => {
      console.log(
        `${chalk.gray(format(new Date(entry.timestamp), 'MMM EEE dd - HH:mm'))} ` +
        `${chalk.blue(`[${entry.project}]`)} ${entry.message} ` +
        `${entry.tags.map(t => chalk.magenta(`#${t}`)).join(' ')}`
      );
    });
  });

program
  .command('mcp')
  .description('Start an MCP server exposing gournal entries, standup reports, and export as tools')
  .action(async () => {
    await startMcpServer();
  });

program.parse(process.argv);