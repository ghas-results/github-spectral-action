const core = require("@actions/core");
const github = require("@actions/github");
const readFilesToAnalyze = require("./read_files");
const { initProcessedPbs, processPbs } = require("./process_pbs");
const { runSpectral, createSpectral } = require("./spectral");
const toMarkdown = require("./to_markdown");
const json_ref_readers_1 = require("@stoplight/json-ref-readers");
const { Resolver } = require("@stoplight/json-ref-resolver");

// most @actions toolkit packages have async methods
async function run() {
  try {
    const resolver = new Resolver({
      // resolvers can do anything, so long as they define an async read function that resolves to a value
      resolvers: {
        file: { resolve: json_ref_readers_1.resolveFile },
      },
    });

    const context = github.context;
    // if (!context.payload.pull_request) {
    //   core.error('this action only works on pull_request events');
    //   core.setOutput('comment-created', 'false');
    //   return;
    // }

    const inputs = {
      githubToken: core.getInput("github-token"),
      fileGlob: core.getInput("file-glob") || "sample/sailpoint.yml",
      spectralRuleset:
        core.getInput("spectral-ruleset") ||
        "https://raw.githubusercontent.com/sailpoint-oss/api-linter/main/root-ruleset.yaml",
      githubURL: core.getInput("github-url"),
    };

    const project = {
      githubURL: inputs.githubURL,
      repository: process.env.GITHUB_REPOSITORY,
      headRef: process.env.GITHUB_HEAD_REF,
      workspace:
        process.env.GITHUB_WORKSPACE ||
        "/Users/tyler.mairose/development/spectral-comment-action/",
    };

    console.log("Workspace:" + project.workspace);
    console.log("FileGlob: " + inputs.fileGlob);
    console.log("File Path: " + project.workspace + "/" + inputs.fileGlob);

    const fileContents = await readFilesToAnalyze(
      project.workspace,
      inputs.fileGlob
    );
    const spectral = await createSpectral(inputs.spectralRuleset);
    let processedPbs = initProcessedPbs();
    for (var i = 0, len = fileContents.length; i < len; i++) {
      console.log("Changing Directory to: " + fileContents[i].file.substr(0, fileContents[i].file.lastIndexOf("/")));
      
      process.chdir(project.workspace + "/" + fileContents[i].file.substr(0, fileContents[i].file.lastIndexOf("/")));

      let resolvedFileContents = resolver.resolve(fileContents[i].content);
      console.dir(
        `Resolved File Contents for: ${fileContents[i].file}: ${
          (await resolvedFileContents).result
        }`
      );

      //console.log(fileContents[i].file + ":" + fileContents[i].content);
      console.log(`Directory Name: ` + __dirname);
      console.log(`Current Working Directory: ` + process.cwd());
      
      const pbs = await runSpectral(spectral, fileContents[i].content);
      //console.dir(pbs);
      processedPbs = processPbs(fileContents[i].file, processedPbs, pbs);
    }

    const md = await toMarkdown(processedPbs, project);

    console.log(md);

    if (md === "") {
      core.info("No lint error found! Congratulation!");
    } else {
      const octokit = new github.GitHub(inputs.githubToken);
      const repoName = context.repo.repo;
      const repoOwner = context.repo.owner;
      const prNumber = context.payload.pull_request.number;
      await octokit.issues.createComment({
        repo: repoName,
        owner: repoOwner,
        body: md,
        issue_number: prNumber,
      });
      if (processedPbs.severitiesCount[0] > 0) {
        core.setFailed(
          "There are " + processedPbs.severitiesCount[0] + " lint errors!"
        );
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
