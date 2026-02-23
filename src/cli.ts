import { Command } from 'commander';
import { registerAgentCommand } from './commands/agent.js';
import { registerCleanupCommand } from './commands/cleanup.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerGroupAddCommand } from './commands/groups/add.js';
import { registerGroupListCommand } from './commands/groups/list.js';
import { registerGroupRemoveCommand } from './commands/groups/remove.js';
import { registerInitCommand } from './commands/init.js';
import { registerLoopCommand } from './commands/loop.js';
import { registerMakeDirCommand } from './commands/make-dir.js';
import { registerRunCommand } from './commands/run.js';
import { registerSkillCommand } from './commands/skill.js';
import { registerAddCommand } from './commands/tools/add.js';
import { registerDiscoverCommand } from './commands/tools/discover.js';
import { registerListCommand } from './commands/tools/list.js';
import { registerRemoveCommand } from './commands/tools/remove.js';
import { registerRenameCommand } from './commands/tools/rename.js';
import { registerTestCommand } from './commands/tools/test.js';
import { registerUpgradeCommand } from './commands/upgrade.js';
import { VERSION } from './constants.js';

const program = new Command();

program
  .name('counselors')
  .description('Fan out prompts to multiple AI coding tools (agents) in parallel')
  .version(VERSION);

// Top-level commands
registerRunCommand(program);
registerLoopCommand(program);
registerMakeDirCommand(program);
registerCleanupCommand(program);
registerConfigCommand(program);
registerDoctorCommand(program);
registerInitCommand(program);
registerAgentCommand(program);
registerSkillCommand(program);
registerUpgradeCommand(program);

// Tools subcommand group
const tools = program
  .command('tools')
  .description('Manage AI tool configurations');

registerDiscoverCommand(tools);
registerAddCommand(tools);
registerRemoveCommand(tools);
registerRenameCommand(tools);
registerListCommand(tools);
registerTestCommand(tools);

// Groups subcommand group
const groups = program
  .command('groups')
  .description('Manage predefined tool groups');

registerGroupListCommand(groups);
registerGroupAddCommand(groups);
registerGroupRemoveCommand(groups);

// Top-level aliases
program
  .command('add [tool]')
  .description('Alias for "tools add"')
  .action(async (tool?: string) => {
    const args = tool ? ['add', tool] : ['add'];
    await tools.parseAsync(args, { from: 'user' });
  });

program
  .command('ls')
  .description('Alias for "tools list"')
  .option('-v, --verbose', 'Show full tool configuration including flags')
  .action(async (opts: { verbose?: boolean }) => {
    const args = ['list'];
    if (opts.verbose) args.push('--verbose');
    await tools.parseAsync(args, { from: 'user' });
  });

program.parseAsync(process.argv).catch((err: Error) => {
  process.stderr.write(`✗ ${err.message}\n`);
  process.exitCode = 1;
});
