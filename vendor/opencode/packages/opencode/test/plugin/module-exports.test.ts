import { describe, expect, test } from "bun:test"

import { Plugin } from "../../src/plugin"

describe("Plugin.testing.collectHooksFromModuleExports", () => {
  test("ignores helper exports that do not return hooks", async () => {
    const pluginFactory = async () => ({
      auth: {
        provider: "portkey",
        methods: [],
      },
    })
    const helper = () => undefined

    const hooks = await Plugin.testing.collectHooksFromModuleExports(
      {
        default: pluginFactory,
        pluginFactory,
        helper,
      },
      {} as never,
    )

    expect(hooks).toHaveLength(1)
    expect(hooks[0]?.auth?.provider).toBe("portkey")
  })

  test("ignores non-function exports", async () => {
    const hooks = await Plugin.testing.collectHooksFromModuleExports(
      {
        value: 123,
        text: "hello",
      },
      {} as never,
    )

    expect(hooks).toEqual([])
  })
})
