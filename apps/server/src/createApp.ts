import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

export type CreateAppOptions = {
  webRoot: string;
};

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: options.webRoot,
  });

  return app;
}
