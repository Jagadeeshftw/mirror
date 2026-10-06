import { parseSse } from "../src/lib/sse";

describe("SSE parser", () => {
  it("parses events, multi-line data, ids, comments and keeps the tail", () => {
    const { messages, rest } = parseSse(": ping\n\nevent: feed\nid: 7\ndata: {\"a\":1}\n\ndata: line1\ndata: line2\n\nevent: commit\ndata: {\"x\"");
    expect(messages).toEqual([
      { event: "feed", data: '{"a":1}', id: "7" },
      { event: "message", data: "line1\nline2", id: undefined },
    ]);
    expect(rest).toBe('event: commit\ndata: {"x"');
  });
  it("handles CRLF", () => {
    expect(parseSse("event: demo\r\ndata: 1\r\n\r\n").messages).toEqual([{ event: "demo", data: "1", id: undefined }]);
  });
});
