// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { DialogProvider, useDialog } from "./DialogContext";

function Harness() {
  const { confirm, prompt } = useDialog();
  const [result, setResult] = useState("idle");

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void confirm({ title: "Delete item?", message: "This cannot be undone." })
            .then((value) => setResult(String(value)));
        }}
      >
        ask confirm
      </button>
      <button
        type="button"
        onClick={() => {
          void prompt({
            title: "Rename subject",
            label: "Subject name",
            initialValue: "Old name",
            submitLabel: "Rename",
          }).then((value) => setResult(value ?? "cancelled"));
        }}
      >
        ask prompt
      </button>
      <output>{result}</output>
    </>
  );
}

function renderHarness() {
  return render(
    <DialogProvider>
      <Harness />
    </DialogProvider>,
  );
}

afterEach(cleanup);

describe("DialogProvider", () => {
  it("resolves a prompt with the edited value", async () => {
    renderHarness();
    fireEvent.click(screen.getByText("ask prompt"));

    const input = screen.getByLabelText("Subject name") as HTMLInputElement;
    expect(input.value).toBe("Old name");
    fireEvent.change(input, { target: { value: "Linear algebra" } });
    fireEvent.click(screen.getByText("Rename"));

    await waitFor(() => {
      expect(screen.getByText("Linear algebra")).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves a confirmation with the chosen answer", async () => {
    renderHarness();
    fireEvent.click(screen.getByText("ask confirm"));
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => {
      expect(screen.getByText("true")).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels a confirmation with Escape", async () => {
    renderHarness();
    fireEvent.click(screen.getByText("ask confirm"));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByText("false")).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
