# Tasks API: STUDENT NAME, STUDENT NUMBER

## Run it

    cp .env.example .env
    deno task dev        # API on http://localhost:8000
    deno task test       # all tests
    deno task check      # type-check

## Try it in a browser (given, not graded)

`ui/` is a small React page that calls your API (log in, add, advance and delete tasks).
Start the API first, then in a second terminal:

    deno task ui:install   # once
    deno task ui:dev       # UI on http://localhost:5173

The UI uses your routes exactly as described in the handout, so it starts to work as soon
as register, login and the task routes do.

## Design decisions (R8)

Tables, routes, and why. In your own words.

## API with curl (R8)

One working `curl` command with its real output for every route.

## My own log (R8)

At least five real things that went wrong or surprised you, with the exact error message.

## Bonuses claimed

Write `Bonus 1: OpenAPI`, `Bonus 2: Rate limit and cache`, `Bonus 3: Docker`,
`Bonus 4: Git repository` here, only for those you did.
