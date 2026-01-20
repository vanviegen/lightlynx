- Please remove the use of the MOCK_Z2M global env variable. Instead, look up MOCK_Z2M_PORT and MOCK_Z2M_CERT in the environment. Within package.json, add these variables for the mock-z2m script to our standard test values (43598 and `pwd`/mock-certs.json).
- Figure out a reliable way to open the dev server in a MCP playwright browser and connect to the mock-z2m server. Write your description of how to do this to AGENTS.md. It should probably involve checking if the 'dev' and 'mock-z2m' scripts are already running, and if not starting them (without blocking). Then it should start the browser, instructing it to ignore ssl errors caused by a self-signed cert, or trusting our specific cert, whatever is easier. It should connect in the browser to the mock-z2m (localhost:43598) with the default user name and no password. If that doesn't work, as the user for a password.


- Currently, test-results contains a .png file for each step. Could you also add a .yaml file that contains containing the page snapshot for each step? That should be easier to analyze for LLMs than the png file (except for visual bugs).
- Also add instructions to AGENTS.md, on how to diagnose a failing test by looking at the files in test-results.

Please consider if using https://aberdeenjs.org/dispatcher/Dispatcher/ would simplify our code in app.ts.


Big task: I want you to completely restructure the HTML and the CSS for this project. Here's what I'd like to see:
- Less clutter in the HTML structure - simplify things!
- No more style.css. Instead...
  - Use inline Aberdeen styling for component-specific styles.
  - Use Aberdeen insertCss for component-specific styles that are too large for inline, would be repetitive, or benefit from combined selectors (for instance depending on parent class) and pseudo classes (like first-child and hover).
  - Use Aberdeen insertGlobalCss for global styles like resets, typography.
- Use standard Aberdeen sizes like @3 and @4 for spacing.
- Define CSS custom props using Aberdeen's `cssVars` for colors (like 'primary') and other design tokens.
- The looks should may become more minimalistic and modern. The striped background can go out. I do want to maintain the current primary color and an overall warmish dark aesthetic, matching the logo (which won't be changing.)

So I want style.css removed entirely and I want a restrained use of insertGlobalCss.

This project uses Aberdeen. Study the Skill to make sure you understand how to use it effectively.
