- Please add a way to connect to a certain server from the URL, by specifying something like /connect?host=192.168.1.94&username=guest&secret=2343246544233211 (where secret is optional). If that happens, the connect page should see if that host and username already exists in the stored servers, and if so, "try" to connect to it. If not, create a new server entry and "try" to connect to it.

- Please remove the use of the MOCK_Z2M global env variable. Instead, look up MOCK_Z2M_PORT in the environment. Also, don't the self signed CERT anymore, instead create a MOCK_Z2M_INSECURE env var. When set, have the extension start the websocket server without tls. Within package.json, add these variables for the mock-z2m script to our standard test values (`43598` and `true`). 

- Also, instead of hardcoding the extension filename in mock-z2m, pass the optional list of extensions to load on startup as command line arguments.

- Create a new 'start-mock' script in package.json that starts the mock-z2m server using MOCK_Z2M_INSECURE=true and MOCK_Z2M_PORT as a random port, and starts a vite dev server on another random port. It should output the http://localhost:port/connect?host=localhost:otherport&username=admin URL that can be used to access it. It should make sure that both programs are shutdown when ctrl-c is pressed.

- Test that you can use 'start-mock' together with the playwright MCP to interact with the app. Once that works fluently, add instructions on how to do that to AGENTS.md.

- Make sure 'npm test' still works.

- Make sure the README.md and AGENTS.md are up-to-date with these changes.


- Update the /connect page such that the current state of the form is reflected in the URL as query parameters (by binding the inputs to properties on route.current.search using `ref`). That way, users can share a link to a prefilled connect form.


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
