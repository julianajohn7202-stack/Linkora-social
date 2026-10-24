import { buildTsQuery, parseQuery, sanitiseQuery } from "../query";

describe("parseQuery", () => {
  it("parses ordinary text into terms", () => {
    expect(parseQuery("hello decentralized world")).toEqual({
      terms: ["hello", "decentralized", "world"],
      hashtags: [],
      mentions: [],
    });
  });

  it("extracts hashtags and mentions while preserving ordinary terms", () => {
    expect(parseQuery("hello #Stellar @alice_42 news")).toEqual({
      terms: ["hello", "news"],
      hashtags: ["Stellar"],
      mentions: ["alice_42"],
    });
  });

  it("removes SQL metacharacters before returning search terms", () => {
    expect(parseQuery("safe; DROP TABLE posts -- 'quoted' (term)")).toEqual({
      terms: ["safe", "DROP", "TABLE", "posts", "quoted", "term"],
      hashtags: [],
      mentions: [],
    });
  });

  it("truncates input to 200 characters before parsing", () => {
    const result = parseQuery(`${"a".repeat(200)} trailing`);
    expect(result.terms).toEqual(["a".repeat(200)]);
  });
});

describe("query sanitisation and tsquery construction", () => {
  it.each(["", "   ", "# @", "& | ! : * < >"])(
    "ignores empty or operator-only input %p",
    (input) => {
      expect(buildTsQuery(input)).toBe("");
    }
  );

  it("strips SQL punctuation and bounds the input", () => {
    expect(sanitiseQuery("'hello'; -- (world)\\\u0000")).not.toMatch(/['";()\\\u0000-\u001f-]/);
    expect(sanitiseQuery("a".repeat(201))).toHaveLength(200);
  });

  it("builds prefix terms joined with AND without accepting operators", () => {
    expect(buildTsQuery("hello | !world:* #Stellar @alice_42")).toBe(
      "hello:* & world:* & Stellar:* & alice_42:*"
    );
  });

  it("handles Unicode, punctuation, multiple identifiers, and email boundaries", () => {
    expect(parseQuery("#café #web3 @alice @bob_2 hello,world a@b.com")).toEqual({
      terms: ["hello", "world", "a", "b", "com"],
      hashtags: ["café", "web3"],
      mentions: ["alice", "bob_2"],
    });
  });
});
