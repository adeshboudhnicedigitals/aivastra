import { appendFileSync, writeFileSync } from 'node:fs';
import { classify, type DetectResult } from './lib/classify.mts';
import { changedFilesBetween, resolveRange } from './lib/git.mts';
import { loadTargets } from './lib/targets.mts';
import {
  assertTargetsMatchWorkspace,
  buildDependentsGraph,
  listWorkspaceManifests,
  readWorkspaceMembers,
} from './lib/workspace.mts';

export function outputLines(result: DetectResult): string[] {
  return [
    `services=${JSON.stringify(result.services)}`,
    `compose_services=${result.services.join(' ')}`,
    `affected_packages=${JSON.stringify(result.affectedPackages)}`,
    `test_targets=${JSON.stringify(result.testTargets)}`,
    `docs_only=${String(result.docsOnly)}`,
    `fallback_to_all=${String(result.fallbackToAll)}`,
    `migration_changed=${String(result.migrationChanged)}`,
    `infrastructure_changed=${String(result.infrastructureChanged)}`,
    `deployment_bundle_changed=${String(result.deploymentBundleChanged)}`,
    `ci_changed=${String(result.ciChanged)}`,
    `has_deployable=${String(result.services.length > 0)}`,
    `has_tests=${String(result.testTargets.length > 0)}`,
    `has_packages=${String(result.affectedPackages.length > 0)}`,
  ];
}

export function renderSummary(result: DetectResult): string {
  const lines: string[] = ['## Affected targets', ''];

  lines.push(`Range: \`${result.baseSha || '(none)'}\` → \`${result.headSha}\``);
  lines.push(`Changed files: ${result.changedFiles.length}`);
  lines.push('');

  if (result.fallbackToAll) {
    lines.push('> **Fell back to all services.** Reasons:');
    for (const reason of result.reasons.ALL ?? []) lines.push(`> - \`${reason}\``);
    lines.push('');
  }

  if (result.docsOnly) {
    lines.push('**Documentation-only change.** No images are built and no deployment runs.');
    lines.push('');
  }

  if (result.services.length === 0) {
    lines.push('No deployable service selected.');
  } else {
    lines.push('| Service | Reasons |');
    lines.push('|---|---|');
    for (const service of result.services) {
      const reasons = result.reasons[service] ?? ['selected through a workspace dependency'];
      lines.push(`| \`${service}\` | ${reasons.map((r) => `\`${r}\``).join('<br>')} |`);
    }
  }

  lines.push('');
  lines.push(`Affected packages: ${result.affectedPackages.length}`);
  lines.push(`Test targets: ${result.testTargets.join(', ') || '(none)'}`);
  lines.push(`Migration changed: ${String(result.migrationChanged)}`);

  return lines.join('\n');
}

function outPathFromArgv(argv: string[]): string {
  const index = argv.indexOf('--out');
  return index >= 0 && argv[index + 1] ? argv[index + 1] : 'affected.json';
}

function main(): void {
  const outPath = outPathFromArgv(process.argv.slice(2));
  const config = loadTargets('config/ci-targets.json');
  const members = readWorkspaceMembers(listWorkspaceManifests());
  assertTargetsMatchWorkspace(config, members);

  const graph = buildDependentsGraph(members);
  const range = resolveRange(process.env);
  const changedFiles = changedFilesBetween(range);

  const result = classify({
    baseSha: range.baseSha,
    headSha: range.headSha,
    changedFiles,
    config,
    members,
    graph,
    fallbackReason: range.fallbackReason,
  });

  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${outputLines(result).join('\n')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${renderSummary(result)}\n`);
  }

  process.stdout.write(`${renderSummary(result)}\n`);
}

// Only run when invoked as a script, so the test file can import the helpers.
if (process.argv[1]?.endsWith('detect-affected.mts')) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`detect-affected failed: ${message}\n`);
    if (process.env.GITHUB_OUTPUT) {
      // Fail safe: an unexpected detector error must select everything.
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        [
          'services=["admin","api","chatbot","dispatcher","shopify-admin","web"]',
          'compose_services=admin api chatbot dispatcher shopify-admin web',
          'docs_only=false',
          'fallback_to_all=true',
          'has_deployable=true',
          'has_tests=true',
          'has_packages=true',
          'migration_changed=true',
          '',
        ].join('\n'),
      );
    }
    process.exitCode = 1;
  }
}
