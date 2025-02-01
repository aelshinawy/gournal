#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { readEntries, writeEntries } from './storage';
import { getProjectName } from './git';
import { generateStandupReport } from './report';
import type { Entry } from './types';
import { format } from 'date-fns';
import inquirer from 'inquirer';

const program = new Command();

program
  .name('gournal')
  .description('CLI development journal with Git integration')
  .version('0.2.0');

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
  .action(async (options) => {
    const entries = await readEntries();
    console.log(generateStandupReport(entries, options));
  });

program
  .command('find <query>')
  .description('Find entries by keyword')
  .option('-p, --project <project>', 'Filter by project name')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (query: string, options: { project?: string; tags?: string }) => {
    const entries = await readEntries();
    
    const results = entries.filter(entry => {
      const matchesText = entry.message.toLowerCase().includes(query.toLowerCase());
      const matchesProject = options.project ? entry.project === options.project : true;
      const matchesTags = options.tags 
        ? options.tags.split(',').every(t => entry.tags.includes(t))
        : true;
      
      return matchesText && matchesProject && matchesTags;
    });

    console.log(chalk.bold(`Found ${results.length} entries:\n`));
    results.forEach(entry => {
      console.log(
        `${chalk.gray(format(new Date(entry.timestamp), 'MMM EEE dd - HH:mm'))} ` +
        `${chalk.blue(`[${entry.project}]`)} ${entry.message} ` +
        `${entry.tags.map(t => chalk.magenta(`#${t}`)).join(' ')}`
      );
    });
  });

program.parse(process.argv);