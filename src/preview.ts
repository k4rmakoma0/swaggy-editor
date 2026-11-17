import SwaggerUIBundle from "swagger-ui-dist/swagger-ui-bundle.js";
import "swagger-ui-dist/swagger-ui.css";

/** Envoltorio de Swagger UI que se actualiza sin volver a montarse. */
export class Preview {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ui: any = null;
  private lastRendered = "";

  constructor(private host: HTMLElement) {}

  render(spec: object) {
    const serialized = JSON.stringify(spec);
    if (serialized === this.lastRendered) return;
    this.lastRendered = serialized;

    if (!this.ui) {
      this.ui = SwaggerUIBundle({
        domNode: this.host,
        spec,
        presets: [SwaggerUIBundle.presets.apis],
        layout: "BaseLayout",
        deepLinking: false,
        validatorUrl: null,
        docExpansion: "list",
        defaultModelsExpandDepth: 1,
        displayRequestDuration: true,
        filter: true,
        syntaxHighlight: { activated: true, theme: "agate" },
      });
    } else {
      this.ui.specActions.updateSpec(serialized);
    }
  }

  reset() {
    this.ui = null;
    this.lastRendered = "";
    this.host.replaceChildren();
  }
}
