#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { readEntries, writeEntries } from './storage';
import { getProjectName } from './git';
import { generateStandupReport } from './report';
import { generateWorkLog } from './log';
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
  .command('standup')
  .description('Generate standup report')
  .option('-y, --yesterday', 'Include yesterday\'s entries')
  .option('-w, --week', 'Show weekly summary')
  .option('-m, --month', 'Show monthly summary')
  .option('-p, --project <project>', 'Filter by project name')
  .action(async (options) => {
    const entries = filterByProject(await readEntries(), options.project);
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
  .command('export')
  .description('Export journal entries to Markdown or CSV')
  .option('-f, --format <format>', 'Output format: md or csv', 'md')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-o, --output <file>', 'Write to a file instead of stdout')
  .action(async (options: { format: string; project?: string; output?: string }) => {
    let entries = filterByProject(await readEntries(), options.project);

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
  .action(async (query: string, options: { project?: string; tags?: string }) => {
    let entries = filterByProject(await readEntries(), options.project);
    entries = filterByTags(entries, options.tags ? options.tags.split(',').filter(Boolean) : undefined);
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