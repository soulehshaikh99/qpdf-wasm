FROM emscripten/emsdk:6.0.13 AS qpdf

RUN apt update && \
    apt install -y autoconf git pkg-config

WORKDIR /src

COPY shallow-clone.sh /usr/local/bin

# zlib v1.3.2
RUN shallow-clone.sh https://github.com/madler/zlib.git /src/lib/zlib da607da739fa6047df13e66a2af6b8bec7c2a498
# libjpeg-turbo 3.2.1
RUN shallow-clone.sh https://github.com/libjpeg-turbo/libjpeg-turbo.git /src/lib/jpeg-turbo 7b4993786d856cbccabfc0ed2f923ba000e326cc

# qpdf version 12.4.2
RUN shallow-clone.sh https://github.com/qpdf/qpdf.git /src/lib/qpdf 4eba95899886e851cc41d76886483b347612f2a8

# first, copy files that are needed for the emscripten build, and
# that would require a full recompile if they changed
COPY js js
COPY patches patches
COPY build.sh build.sh

RUN ./build.sh

# then copy files needed only for the final NPM package,
# so the expensive previous layer is cached
COPY types/qpdf.d.ts dist/qpdf.d.ts

FROM node:24

COPY --from=qpdf /src/dist /opt/qpdf
COPY entrypoint.sh /usr/local/bin

USER node

WORKDIR /src

ENTRYPOINT ["entrypoint.sh"]