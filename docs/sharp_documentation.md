# Constructor | sharp

# Constructor

## Sharp

> Sharp

**Emits** : `Sharp#event:info`, `Sharp#event:warning`  

### new

> new Sharp([input], [options])

Constructor factory to create an instance of `sharp`, to which further methods
are chained.

JPEG, PNG, WebP, GIF, AVIF or TIFF format image data can be streamed out from
this object. When using Stream based output, derived attributes are available
from the `info` event.

Non-critical problems encountered during processing are emitted as `warning`
events.

Implements the
[stream.Duplex](http://nodejs.org/api/stream.html#stream_class_stream_duplex)
class.

When loading more than one page/frame of an animated image, these are combined
as a vertically-stacked “toilet roll” image where the overall height is the
`pageHeight` multiplied by the number of `pages`.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[input]| `Buffer` | `ArrayBuffer` | `Uint8Array` | `Uint8ClampedArray` | `Int8Array` | `Uint16Array` | `Int16Array` | `Uint32Array` | `Int32Array` | `Float32Array` | `Float64Array` | `string` | `Array`| | if present, can be a Buffer / ArrayBuffer / Uint8Array / Uint8ClampedArray containing JPEG, PNG, WebP, AVIF, GIF, SVG or TIFF image data, or a TypedArray containing raw pixel image data, or a String containing the filesystem path to an JPEG, PNG, WebP, AVIF, GIF, SVG or TIFF image file. An array of inputs can be provided, and these will be joined together. JPEG, PNG, WebP, AVIF, GIF, SVG, TIFF or raw pixel image data can be streamed into the object when not present.  
[options]| `Object`| | if present, is an Object with optional attributes.  
[options.failOn]| `string`| `“‘warning‘“`| When to abort processing of invalid
pixel data, one of (in order of sensitivity, least to most): ‘none’,
‘truncated’, ‘error’, ‘warning’. Higher levels imply lower levels. Invalid
metadata will always abort.  
[options.limitInputPixels]| `number` | `boolean`| `268402689`| Do not process input images where the number of pixels (width x height) exceeds this limit. Assumes image dimensions contained in the input metadata can be trusted. An integral Number of pixels, zero or false to remove limit, true to use default limit of 268402689 (0x3FFF x 0x3FFF).  
[options.unlimited]| `boolean`| `false`| Set this to `true` to remove safety
features that help prevent memory exhaustion (JPEG, PNG, SVG, HEIF).  
[options.autoOrient]| `boolean`| `false`| Set this to `true` to rotate/flip
the image to match EXIF `Orientation`, if any.  
[options.sequentialRead]| `boolean`| `true`| Set this to `false` to use random
access rather than sequential read. Some operations will do this
automatically.  
[options.density]| `number`| `72`| number representing the DPI for vector
images in the range 1 to 100000.  
[options.ignoreIcc]| `number`| `false`| should the embedded ICC profile, if
any, be ignored.  
[options.pages]| `number`| `1`| Number of pages to extract for multi-page
input (GIF, WebP, TIFF), use -1 for all pages.  
[options.page]| `number`| `0`| Page number to start extracting from for multi-
page input (GIF, WebP, TIFF), zero based.  
[options.subifd]| `number`| `-1`| subIFD (Sub Image File Directory) to extract
for OME-TIFF, defaults to main image.  
[options.level]| `number`| `0`| level to extract from a multi-level input
(OpenSlide), zero based.  
[options.pdfBackground]| `string` | `Object`| | Background colour to use when PDF is partially transparent. Parsed by the [color](https://www.npmjs.org/package/color) module to extract values for red, green, blue and alpha. Requires the use of a globally-installed libvips compiled with support for PDFium, Poppler, ImageMagick or GraphicsMagick.  
[options.animated]| `boolean`| `false`| Set to `true` to read all frames/pages
of an animated image (GIF, WebP, TIFF), equivalent of setting `pages` to `-1`.  
[options.raw]| `Object`| | describes raw pixel input image data. See `raw()` for pixel ordering.  
[options.raw.width]| `number`| | integral number of pixels wide.  
[options.raw.height]| `number`| | integral number of pixels high.  
[options.raw.channels]| `number`| | integral number of channels, between 1 and 4.  
[options.raw.premultiplied]| `boolean`| | specifies that the raw input has already been premultiplied, set to `true` to avoid sharp premultiplying the image. (optional, default `false`)  
[options.create]| `Object`| | describes a new image to be created.  
[options.create.width]| `number`| | integral number of pixels wide.  
[options.create.height]| `number`| | integral number of pixels high.  
[options.create.channels]| `number`| | integral number of channels, either 3 (RGB) or 4 (RGBA).  
[options.create.background]| `string` | `Object`| | parsed by the [color](https://www.npmjs.org/package/color) module to extract values for red, green, blue and alpha.  
[options.create.noise]| `Object`| | describes a noise to be created.  
[options.create.noise.type]| `string`| | type of generated noise, currently only `gaussian` is supported.  
[options.create.noise.mean]| `number`| | mean of pixels in generated noise.  
[options.create.noise.sigma]| `number`| | standard deviation of pixels in generated noise.  
[options.text]| `Object`| | describes a new text image to be created.  
[options.text.text]| `string`| | text to render as a UTF-8 string. It can contain Pango markup, for example `<i>Le</i>Monde`.  
[options.text.font]| `string`| | font name to render with.  
[options.text.fontfile]| `string`| | absolute filesystem path to a font file that can be used by `font`.  
[options.text.width]| `number`| `0`| Integral number of pixels to word-wrap
at. Lines of text wider than this will be broken at word boundaries.  
[options.text.height]| `number`| `0`| Maximum integral number of pixels high.
When defined, `dpi` will be ignored and the text will automatically fit the
pixel resolution defined by `width` and `height`. Will be ignored if `width`
is not specified or set to 0.  
[options.text.align]| `string`| `“‘left‘“`| Alignment style for multi-line
text (`'left'`, `'centre'`, `'center'`, `'right'`).  
[options.text.justify]| `boolean`| `false`| set this to true to apply
justification to the text.  
[options.text.dpi]| `number`| `72`| the resolution (size) at which to render
the text. Does not take effect if `height` is specified.  
[options.text.rgba]| `boolean`| `false`| set this to true to enable RGBA
output. This is useful for colour emoji rendering, or support for pango markup
features like `<span foreground="red">Red!</span>`.  
[options.text.spacing]| `number`| `0`| text line height in points. Will use
the font line height if none is specified.  
[options.text.wrap]| `string`| `“‘word‘“`| word wrapping style when width is
provided, one of: ‘word’, ‘char’, ‘word-char’ (prefer word, fallback to char)
or ‘none’.  
[options.join]| `Object`| | describes how an array of input images should be joined.  
[options.join.across]| `number`| `1`| number of images to join horizontally.  
[options.join.animated]| `boolean`| `false`| set this to `true` to join the
images as an animated image.  
[options.join.shim]| `number`| `0`| number of pixels to insert between joined
images.  
[options.join.background]| `string` | `Object`| | parsed by the [color](https://www.npmjs.org/package/color) module to extract values for red, green, blue and alpha.  
[options.join.halign]| `string`| `“‘left‘“`| horizontal alignment style for
images joined horizontally (`'left'`, `'centre'`, `'center'`, `'right'`).  
[options.join.valign]| `string`| `“‘top‘“`| vertical alignment style for
images joined vertically (`'top'`, `'centre'`, `'center'`, `'bottom'`).  
  
**Example**

    
    
    sharp('input.jpg')
    
      .resize(300, 200)
    
      .toFile('output.jpg', function(err) {
    
        // output.jpg is a 300 pixels wide and 200 pixels high image
    
        // containing a scaled and cropped version of input.jpg
    
      });

**Example**

    
    
    // Read image data from remote URL,
    
    // resize to 300 pixels wide,
    
    // emit an 'info' event with calculated dimensions
    
    // and finally write image data to writableStream
    
    const { body } = fetch('https://...');
    
    const readableStream = Readable.fromWeb(body);
    
    const transformer = sharp()
    
      .resize(300)
    
      .on('info', ({ height }) => {
    
        console.log(`Image height is ${height}`);
    
      });
    
    readableStream.pipe(transformer).pipe(writableStream);

**Example**

    
    
    // Create a blank 300x200 PNG image of semi-translucent red pixels
    
    sharp({
    
      create: {
    
        width: 300,
    
        height: 200,
    
        channels: 4,
    
        background: { r: 255, g: 0, b: 0, alpha: 0.5 }
    
      }
    
    })
    
    .png()
    
    .toBuffer()
    
    .then( ... );

**Example**

    
    
    // Convert an animated GIF to an animated WebP
    
    await sharp('in.gif', { animated: true }).toFile('out.webp');

**Example**

    
    
    // Read a raw array of pixels and save it to a png
    
    const input = Uint8Array.from([255, 255, 255, 0, 0, 0]); // or Uint8ClampedArray
    
    const image = sharp(input, {
    
      // because the input does not contain its dimensions or how many channels it has
    
      // we need to specify it in the constructor options
    
      raw: {
    
        width: 2,
    
        height: 1,
    
        channels: 3
    
      }
    
    });
    
    await image.toFile('my-two-pixels.png');

**Example**

    
    
    // Generate RGB Gaussian noise
    
    await sharp({
    
      create: {
    
        width: 300,
    
        height: 200,
    
        channels: 3,
    
        noise: {
    
          type: 'gaussian',
    
          mean: 128,
    
          sigma: 30
    
        }
    
     }
    
    }).toFile('noise.png');

**Example**

    
    
    // Generate an image from text
    
    await sharp({
    
      text: {
    
        text: 'Hello, world!',
    
        width: 400, // max width
    
        height: 300 // max height
    
      }
    
    }).toFile('text_bw.png');

**Example**

    
    
    // Generate an rgba image from text using pango markup and font
    
    await sharp({
    
      text: {
    
        text: '<span foreground="red">Red!</span><span background="cyan">blue</span>',
    
        font: 'sans',
    
        rgba: true,
    
        dpi: 300
    
      }
    
    }).toFile('text_rgba.png');

**Example**

    
    
    // Join four input images as a 2x2 grid with a 4 pixel gutter
    
    const data = await sharp(
    
     [image1, image2, image3, image4],
    
     { join: { across: 2, shim: 4 } }
    
    ).toBuffer();

**Example**

    
    
    // Generate a two-frame animated image from emoji
    
    const images = ['😀', '😛'].map(text => ({
    
      text: { text, width: 64, height: 64, channels: 4, rgba: true }
    
    }));
    
    await sharp(images, { join: { animated: true } }).toFile('out.gif');

## clone

> clone() ⇒ `Sharp`

Take a “snapshot” of the Sharp instance, returning a new instance. Cloned
instances inherit the input of their parent instance. This allows multiple
output Streams and therefore multiple processing pipelines to share a single
input Stream.

**Example**

    
    
    const pipeline = sharp().rotate();
    
    pipeline.clone().resize(800, 600).pipe(firstWritableStream);
    
    pipeline.clone().extract({ left: 20, top: 20, width: 100, height: 100 }).pipe(secondWritableStream);
    
    readableStream.pipe(pipeline);
    
    // firstWritableStream receives auto-rotated, resized readableStream
    
    // secondWritableStream receives auto-rotated, extracted region of readableStream

**Example**

    
    
    // Create a pipeline that will download an image, resize it and format it to different files
    
    // Using Promises to know when the pipeline is complete
    
    const fs = require("fs");
    
    const got = require("got");
    
    const sharpStream = sharp({ failOn: 'none' });
    
    
    
    
    const promises = [];
    
    
    
    
    promises.push(
    
      sharpStream
    
        .clone()
    
        .jpeg({ quality: 100 })
    
        .toFile("originalFile.jpg")
    
    );
    
    
    
    
    promises.push(
    
      sharpStream
    
        .clone()
    
        .resize({ width: 500 })
    
        .jpeg({ quality: 80 })
    
        .toFile("optimized-500.jpg")
    
    );
    
    
    
    
    promises.push(
    
      sharpStream
    
        .clone()
    
        .resize({ width: 500 })
    
        .webp({ quality: 80 })
    
        .toFile("optimized-500.webp")
    
    );
    
    
    
    
    // https://github.com/sindresorhus/got/blob/main/documentation/3-streams.md
    
    got.stream("https://www.example.com/some-file.jpg").pipe(sharpStream);
    
    
    
    
    Promise.all(promises)
    
      .then(res => { console.log("Done!", res); })
    
      .catch(err => {
    
        console.error("Error processing files, let's clean it up", err);
    
        try {
    
          fs.unlinkSync("originalFile.jpg");
    
          fs.unlinkSync("optimized-500.jpg");
    
          fs.unlinkSync("optimized-500.webp");
    
        } catch (e) {}
    
      });

[ Previous  
Installation ](/install/) [ Next  
Input metadata ](/api-input/)

# Input metadata | sharp

# Input metadata

## metadata

> metadata([callback]) ⇒ `Promise.<Object>` | `Sharp`

Fast access to (uncached) image metadata without decoding any compressed pixel
data.

This is read from the header of the input image. It does not take into
consideration any operations to be applied to the output image, such as resize
or rotate.

Dimensions in the response will respect the `page` and `pages` properties of
the [constructor parameters](/api-constructor#parameters).

A `Promise` is returned when `callback` is not provided.

  * `format`: Name of decoder used to decompress image data e.g. `jpeg`, `png`, `webp`, `gif`, `svg`
  * `size`: Total size of image in bytes, for Stream and Buffer input only
  * `width`: Number of pixels wide (EXIF orientation is not taken into consideration, see example below)
  * `height`: Number of pixels high (EXIF orientation is not taken into consideration, see example below)
  * `space`: Name of colour space interpretation e.g. `srgb`, `rgb`, `cmyk`, `lab`, `b-w` […](https://www.libvips.org/API/current/VipsImage.html#VipsInterpretation)
  * `channels`: Number of bands e.g. `3` for sRGB, `4` for CMYK
  * `depth`: Name of pixel depth format e.g. `uchar`, `char`, `ushort`, `float` […](https://www.libvips.org/API/current/VipsImage.html#VipsBandFormat)
  * `density`: Number of pixels per inch (DPI), if present
  * `chromaSubsampling`: String containing JPEG chroma subsampling, `4:2:0` or `4:4:4` for RGB, `4:2:0:4` or `4:4:4:4` for CMYK
  * `isProgressive`: Boolean indicating whether the image is interlaced using a progressive scan
  * `isPalette`: Boolean indicating whether the image is palette-based (GIF, PNG).
  * `bitsPerSample`: Number of bits per sample for each channel (GIF, PNG, HEIF).
  * `pages`: Number of pages/frames contained within the image, with support for TIFF, HEIF, PDF, animated GIF and animated WebP
  * `pageHeight`: Number of pixels high each page in a multi-page image will be.
  * `loop`: Number of times to loop an animated image, zero refers to a continuous loop.
  * `delay`: Delay in ms between each page in an animated image, provided as an array of integers.
  * `pagePrimary`: Number of the primary page in a HEIF image
  * `levels`: Details of each level in a multi-level image provided as an array of objects, requires libvips compiled with support for OpenSlide
  * `subifds`: Number of Sub Image File Directories in an OME-TIFF image
  * `background`: Default background colour, if present, for PNG (bKGD) and GIF images
  * `compression`: The encoder used to compress an HEIF file, `av1` (AVIF) or `hevc` (HEIC)
  * `resolutionUnit`: The unit of resolution (density), either `inch` or `cm`, if present
  * `hasProfile`: Boolean indicating the presence of an embedded ICC profile
  * `hasAlpha`: Boolean indicating the presence of an alpha transparency channel
  * `orientation`: Number value of the EXIF Orientation header, if present
  * `exif`: Buffer containing raw EXIF data, if present
  * `icc`: Buffer containing raw [ICC](https://www.npmjs.com/package/icc) profile data, if present
  * `iptc`: Buffer containing raw IPTC data, if present
  * `xmp`: Buffer containing raw XMP data, if present
  * `tifftagPhotoshop`: Buffer containing raw TIFFTAG_PHOTOSHOP data, if present
  * `formatMagick`: String containing format for images loaded via *magick
  * `comments`: Array of keyword/text pairs representing PNG text blocks, if present.

Param| Type| Description  
---|---|---  
[callback]| `function`| called with the arguments `(err, metadata)`  
  
**Example**

    
    
    const metadata = await sharp(input).metadata();

**Example**

    
    
    const image = sharp(inputJpg);
    
    image
    
      .metadata()
    
      .then(function(metadata) {
    
        return image
    
          .resize(Math.round(metadata.width / 2))
    
          .webp()
    
          .toBuffer();
    
      })
    
      .then(function(data) {
    
        // data contains a WebP image half the width and height of the original JPEG
    
      });

**Example**

    
    
    // Get dimensions taking EXIF Orientation into account.
    
    const { autoOrient } = await sharp(input).metadata();
    
    const { width, height } = autoOrient;

## stats

> stats([callback]) ⇒ `Promise.<Object>`

Access to pixel-derived image statistics for every channel in the image. A
`Promise` is returned when `callback` is not provided.

  * `channels`: Array of channel statistics for each channel in the image. Each channel statistic contains 
    * `min` (minimum value in the channel)
    * `max` (maximum value in the channel)
    * `sum` (sum of all values in a channel)
    * `squaresSum` (sum of squared values in a channel)
    * `mean` (mean of the values in a channel)
    * `stdev` (standard deviation for the values in a channel)
    * `minX` (x-coordinate of one of the pixel where the minimum lies)
    * `minY` (y-coordinate of one of the pixel where the minimum lies)
    * `maxX` (x-coordinate of one of the pixel where the maximum lies)
    * `maxY` (y-coordinate of one of the pixel where the maximum lies)
  * `isOpaque`: Is the image fully opaque? Will be `true` if the image has no alpha channel or if every pixel is fully opaque.
  * `entropy`: Histogram-based estimation of greyscale entropy, discarding alpha channel if any.
  * `sharpness`: Estimation of greyscale sharpness based on the standard deviation of a Laplacian convolution, discarding alpha channel if any.
  * `dominant`: Object containing most dominant sRGB colour based on a 4096-bin 3D histogram.

**Note** : Statistics are derived from the original input image. Any
operations performed on the image must first be written to a buffer in order
to run `stats` on the result (see third example).

Param| Type| Description  
---|---|---  
[callback]| `function`| called with the arguments `(err, stats)`  
  
**Example**

    
    
    const image = sharp(inputJpg);
    
    image
    
      .stats()
    
      .then(function(stats) {
    
         // stats contains the channel-wise statistics array and the isOpaque value
    
      });

**Example**

    
    
    const { entropy, sharpness, dominant } = await sharp(input).stats();
    
    const { r, g, b } = dominant;

**Example**

    
    
    const image = sharp(input);
    
    // store intermediate result
    
    const part = await image.extract(region).toBuffer();
    
    // create new instance to obtain statistics of extracted region
    
    const stats = await sharp(part).stats();

[ Previous  
Constructor ](/api-constructor/) [ Next  
Output options ](/api-output/)

# Output options | sharp

# Output options

## toFile

> toFile(fileOut, [callback]) ⇒ `Promise.<Object>`

Write output image data to a file.

If an explicit output format is not selected, it will be inferred from the
extension, with JPEG, PNG, WebP, AVIF, TIFF, GIF, DZI, and libvips’ V format
supported. Note that raw pixel data is only supported for buffer output.

By default all metadata will be removed, which includes EXIF-based
orientation. See withMetadata for control over this.

The caller is responsible for ensuring directory structures and permissions
exist.

A `Promise` is returned when `callback` is not provided.

**Returns** : `Promise.<Object>` \- - when no callback is provided  
**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
fileOut| `string`| the path to write the image data to.  
[callback]| `function`| called on completion with two arguments `(err, info)`.
`info` contains the output image `format`, `size` (bytes), `width`, `height`,
`channels` and `premultiplied` (indicating if premultiplication was used).
When using a crop strategy also contains `cropOffsetLeft` and `cropOffsetTop`.
When using the attention crop strategy also contains `attentionX` and
`attentionY`, the focal point of the cropped region. Animated output will also
contain `pageHeight` and `pages`. May also contain `textAutofitDpi` (dpi the
font was rendered at) if image was created from text.  
  
**Example**

    
    
    sharp(input)
    
      .toFile('output.png', (err, info) => { ... });

**Example**

    
    
    sharp(input)
    
      .toFile('output.png')
    
      .then(info => { ... })
    
      .catch(err => { ... });

## toBuffer

> toBuffer([options], [callback]) ⇒ `Promise.<Buffer>`

Write output to a Buffer. JPEG, PNG, WebP, AVIF, TIFF, GIF and raw pixel data
output are supported.

Use toFormat or one of the format-specific functions such as jpeg, png etc. to
set the output format.

If no explicit format is set, the output format will match the input image,
except SVG input which becomes PNG output.

By default all metadata will be removed, which includes EXIF-based
orientation. See withMetadata for control over this.

`callback`, if present, gets three arguments `(err, data, info)` where:

  * `err` is an error, if any.
  * `data` is the output image data.
  * `info` contains the output image `format`, `size` (bytes), `width`, `height`, `channels` and `premultiplied` (indicating if premultiplication was used). When using a crop strategy also contains `cropOffsetLeft` and `cropOffsetTop`. Animated output will also contain `pageHeight` and `pages`. May also contain `textAutofitDpi` (dpi the font was rendered at) if image was created from text.

A `Promise` is returned when `callback` is not provided.

**Returns** : `Promise.<Buffer>` \- - when no callback is provided

Param| Type| Description  
---|---|---  
[options]| `Object`|  
[options.resolveWithObject]| `boolean`| Resolve the Promise with an Object
containing `data` and `info` properties instead of resolving only with `data`.  
[callback]| `function`|  
  
**Example**

    
    
    sharp(input)
    
      .toBuffer((err, data, info) => { ... });

**Example**

    
    
    sharp(input)
    
      .toBuffer()
    
      .then(data => { ... })
    
      .catch(err => { ... });

**Example**

    
    
    sharp(input)
    
      .png()
    
      .toBuffer({ resolveWithObject: true })
    
      .then(({ data, info }) => { ... })
    
      .catch(err => { ... });

**Example**

    
    
    const { data, info } = await sharp('my-image.jpg')
    
      // output the raw pixels
    
      .raw()
    
      .toBuffer({ resolveWithObject: true });
    
    
    
    
    // create a more type safe way to work with the raw pixel data
    
    // this will not copy the data, instead it will change `data`s underlying ArrayBuffer
    
    // so `data` and `pixelArray` point to the same memory location
    
    const pixelArray = new Uint8ClampedArray(data.buffer);
    
    
    
    
    // When you are done changing the pixelArray, sharp takes the `pixelArray` as an input
    
    const { width, height, channels } = info;
    
    await sharp(pixelArray, { raw: { width, height, channels } })
    
      .toFile('my-changed-image.jpg');

## keepExif

> keepExif() ⇒ `Sharp`

Keep all EXIF metadata from the input image in the output image.

EXIF metadata is unsupported for TIFF output.

**Since** : 0.33.0  
**Example**

    
    
    const outputWithExif = await sharp(inputWithExif)
    
      .keepExif()
    
      .toBuffer();

## withExif

> withExif(exif) ⇒ `Sharp`

Set EXIF metadata in the output image, ignoring any EXIF in the input image.

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.33.0

Param| Type| Description  
---|---|---  
exif| `Object.<string, Object.<string, string>>`| Object keyed by IFD0, IFD1
etc. of key/value string pairs to write as EXIF data.  
  
**Example**

    
    
    const dataWithExif = await sharp(input)
    
      .withExif({
    
        IFD0: {
    
          Copyright: 'The National Gallery'
    
        },
    
        IFD3: {
    
          GPSLatitudeRef: 'N',
    
          GPSLatitude: '51/1 30/1 3230/100',
    
          GPSLongitudeRef: 'W',
    
          GPSLongitude: '0/1 7/1 4366/100'
    
        }
    
      })
    
      .toBuffer();

## withExifMerge

> withExifMerge(exif) ⇒ `Sharp`

Update EXIF metadata from the input image in the output image.

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.33.0

Param| Type| Description  
---|---|---  
exif| `Object.<string, Object.<string, string>>`| Object keyed by IFD0, IFD1
etc. of key/value string pairs to write as EXIF data.  
  
**Example**

    
    
    const dataWithMergedExif = await sharp(inputWithExif)
    
      .withExifMerge({
    
        IFD0: {
    
          Copyright: 'The National Gallery'
    
        }
    
      })
    
      .toBuffer();

## keepIccProfile

> keepIccProfile() ⇒ `Sharp`

Keep ICC profile from the input image in the output image.

Where necessary, will attempt to convert the output colour space to match the
profile.

**Since** : 0.33.0  
**Example**

    
    
    const outputWithIccProfile = await sharp(inputWithIccProfile)
    
      .keepIccProfile()
    
      .toBuffer();

## withIccProfile

> withIccProfile(icc, [options]) ⇒ `Sharp`

Transform using an ICC profile and attach to the output image.

This can either be an absolute filesystem path or built-in profile name
(`srgb`, `p3`, `cmyk`).

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.33.0

Param| Type| Default| Description  
---|---|---|---  
icc| `string`| | Absolute filesystem path to output ICC profile or built-in profile name (srgb, p3, cmyk).  
[options]| `Object`| |   
[options.attach]| `number`| `true`| Should the ICC profile be included in the
output image metadata?  
  
**Example**

    
    
    const outputWithP3 = await sharp(input)
    
      .withIccProfile('p3')
    
      .toBuffer();

## keepMetadata

> keepMetadata() ⇒ `Sharp`

Keep all metadata (EXIF, ICC, XMP, IPTC) from the input image in the output
image.

The default behaviour, when `keepMetadata` is not used, is to convert to the
device-independent sRGB colour space and strip all metadata, including the
removal of any ICC profile.

**Since** : 0.33.0  
**Example**

    
    
    const outputWithMetadata = await sharp(inputWithMetadata)
    
      .keepMetadata()
    
      .toBuffer();

## withMetadata

> withMetadata([options]) ⇒ `Sharp`

Keep most metadata (EXIF, XMP, IPTC) from the input image in the output image.

This will also convert to and add a web-friendly sRGB ICC profile if
appropriate.

Allows orientation and density to be set or updated.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
[options]| `Object`|  
[options.orientation]| `number`| Used to update the EXIF `Orientation` tag,
integer between 1 and 8.  
[options.density]| `number`| Number of pixels per inch (DPI).  
  
**Example**

    
    
    const outputSrgbWithMetadata = await sharp(inputRgbWithMetadata)
    
      .withMetadata()
    
      .toBuffer();

**Example**

    
    
    // Set output metadata to 96 DPI
    
    const data = await sharp(input)
    
      .withMetadata({ density: 96 })
    
      .toBuffer();

## toFormat

> toFormat(format, options) ⇒ `Sharp`

Force output to a given format.

**Throws** :

  * `Error` unsupported format or options

Param| Type| Description  
---|---|---  
format| `string` | `Object`| as a string or an Object with an ‘id’ attribute  
options| `Object`| output options  
  
**Example**

    
    
    // Convert any input to PNG output
    
    const data = await sharp(input)
    
      .toFormat('png')
    
      .toBuffer();

## jpeg

> jpeg([options]) ⇒ `Sharp`

Use these JPEG options for output image.

**Throws** :

  * `Error` Invalid options

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.quality]| `number`| `80`| quality, integer 1-100  
[options.progressive]| `boolean`| `false`| use progressive (interlace) scan  
[options.chromaSubsampling]| `string`| `“‘4:2:0‘“`| set to ‘4:4:4’ to prevent
chroma subsampling otherwise defaults to ‘4:2:0’ chroma subsampling  
[options.optimiseCoding]| `boolean`| `true`| optimise Huffman coding tables  
[options.optimizeCoding]| `boolean`| `true`| alternative spelling of
optimiseCoding  
[options.mozjpeg]| `boolean`| `false`| use mozjpeg defaults, equivalent to `{
trellisQuantisation: true, overshootDeringing: true, optimiseScans: true,
quantisationTable: 3 }`  
[options.trellisQuantisation]| `boolean`| `false`| apply trellis quantisation  
[options.overshootDeringing]| `boolean`| `false`| apply overshoot deringing  
[options.optimiseScans]| `boolean`| `false`| optimise progressive scans,
forces progressive  
[options.optimizeScans]| `boolean`| `false`| alternative spelling of
optimiseScans  
[options.quantisationTable]| `number`| `0`| quantization table to use, integer
0-8  
[options.quantizationTable]| `number`| `0`| alternative spelling of
quantisationTable  
[options.force]| `boolean`| `true`| force JPEG output, otherwise attempt to
use input format  
  
**Example**

    
    
    // Convert any input to very high quality JPEG output
    
    const data = await sharp(input)
    
      .jpeg({
    
        quality: 100,
    
        chromaSubsampling: '4:4:4'
    
      })
    
      .toBuffer();

**Example**

    
    
    // Use mozjpeg to reduce output JPEG file size (slower)
    
    const data = await sharp(input)
    
      .jpeg({ mozjpeg: true })
    
      .toBuffer();

## png

> png([options]) ⇒ `Sharp`

Use these PNG options for output image.

By default, PNG output is full colour at 8 bits per pixel.

Indexed PNG input at 1, 2 or 4 bits per pixel is converted to 8 bits per
pixel. Set `palette` to `true` for slower, indexed PNG output.

For 16 bits per pixel output, convert to `rgb16` via [toColourspace](/api-
colour#tocolourspace).

**Throws** :

  * `Error` Invalid options

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| |   
[options.progressive]| `boolean`| `false`| use progressive (interlace) scan  
[options.compressionLevel]| `number`| `6`| zlib compression level, 0 (fastest,
largest) to 9 (slowest, smallest)  
[options.adaptiveFiltering]| `boolean`| `false`| use adaptive row filtering  
[options.palette]| `boolean`| `false`| quantise to a palette-based image with
alpha transparency support  
[options.quality]| `number`| `100`| use the lowest number of colours needed to
achieve given quality, sets `palette` to `true`  
[options.effort]| `number`| `7`| CPU effort, between 1 (fastest) and 10
(slowest), sets `palette` to `true`  
[options.colours]| `number`| `256`| maximum number of palette entries, sets
`palette` to `true`  
[options.colors]| `number`| `256`| alternative spelling of `options.colours`,
sets `palette` to `true`  
[options.dither]| `number`| `1.0`| level of Floyd-Steinberg error diffusion,
sets `palette` to `true`  
[options.force]| `boolean`| `true`| force PNG output, otherwise attempt to use
input format  
  
**Example**

    
    
    // Convert any input to full colour PNG output
    
    const data = await sharp(input)
    
      .png()
    
      .toBuffer();

**Example**

    
    
    // Convert any input to indexed PNG output (slower)
    
    const data = await sharp(input)
    
      .png({ palette: true })
    
      .toBuffer();

**Example**

    
    
    // Output 16 bits per pixel RGB(A)
    
    const data = await sharp(input)
    
     .toColourspace('rgb16')
    
     .png()
    
     .toBuffer();

## webp

> webp([options]) ⇒ `Sharp`

Use these WebP options for output image.

**Throws** :

  * `Error` Invalid options

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.quality]| `number`| `80`| quality, integer 1-100  
[options.alphaQuality]| `number`| `100`| quality of alpha layer, integer 0-100  
[options.lossless]| `boolean`| `false`| use lossless compression mode  
[options.nearLossless]| `boolean`| `false`| use near_lossless compression mode  
[options.smartSubsample]| `boolean`| `false`| use high quality chroma
subsampling  
[options.smartDeblock]| `boolean`| `false`| auto-adjust the deblocking filter,
can improve low contrast edges (slow)  
[options.preset]| `string`| `“‘default‘“`| named preset for
preprocessing/filtering, one of: default, photo, picture, drawing, icon, text  
[options.effort]| `number`| `4`| CPU effort, between 0 (fastest) and 6
(slowest)  
[options.loop]| `number`| `0`| number of animation iterations, use 0 for
infinite animation  
[options.delay]| `number` | `Array.<number>`| | delay(s) between animation frames (in milliseconds)  
[options.minSize]| `boolean`| `false`| prevent use of animation key frames to
minimise file size (slow)  
[options.mixed]| `boolean`| `false`| allow mixture of lossy and lossless
animation frames (slow)  
[options.force]| `boolean`| `true`| force WebP output, otherwise attempt to
use input format  
  
**Example**

    
    
    // Convert any input to lossless WebP output
    
    const data = await sharp(input)
    
      .webp({ lossless: true })
    
      .toBuffer();

**Example**

    
    
    // Optimise the file size of an animated WebP
    
    const outputWebp = await sharp(inputWebp, { animated: true })
    
      .webp({ effort: 6 })
    
      .toBuffer();

## gif

> gif([options]) ⇒ `Sharp`

Use these GIF options for the output image.

The first entry in the palette is reserved for transparency.

The palette of the input image will be re-used if possible.

**Throws** :

  * `Error` Invalid options

**Since** : 0.30.0

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.reuse]| `boolean`| `true`| re-use existing palette, otherwise
generate new (slow)  
[options.progressive]| `boolean`| `false`| use progressive (interlace) scan  
[options.colours]| `number`| `256`| maximum number of palette entries,
including transparency, between 2 and 256  
[options.colors]| `number`| `256`| alternative spelling of `options.colours`  
[options.effort]| `number`| `7`| CPU effort, between 1 (fastest) and 10
(slowest)  
[options.dither]| `number`| `1.0`| level of Floyd-Steinberg error diffusion,
between 0 (least) and 1 (most)  
[options.interFrameMaxError]| `number`| `0`| maximum inter-frame error for
transparency, between 0 (lossless) and 32  
[options.interPaletteMaxError]| `number`| `3`| maximum inter-palette error for
palette reuse, between 0 and 256  
[options.loop]| `number`| `0`| number of animation iterations, use 0 for
infinite animation  
[options.delay]| `number` | `Array.<number>`| | delay(s) between animation frames (in milliseconds)  
[options.force]| `boolean`| `true`| force GIF output, otherwise attempt to use
input format  
  
**Example**

    
    
    // Convert PNG to GIF
    
    await sharp(pngBuffer)
    
      .gif()
    
      .toBuffer();

**Example**

    
    
    // Convert animated WebP to animated GIF
    
    await sharp('animated.webp', { animated: true })
    
      .toFile('animated.gif');

**Example**

    
    
    // Create a 128x128, cropped, non-dithered, animated thumbnail of an animated GIF
    
    const out = await sharp('in.gif', { animated: true })
    
      .resize({ width: 128, height: 128 })
    
      .gif({ dither: 0 })
    
      .toBuffer();

**Example**

    
    
    // Lossy file size reduction of animated GIF
    
    await sharp('in.gif', { animated: true })
    
      .gif({ interFrameMaxError: 8 })
    
      .toFile('optim.gif');

## jp2

> jp2([options]) ⇒ `Sharp`

Use these JP2 options for output image.

Requires libvips compiled with support for OpenJPEG. The prebuilt binaries do
not include this - see [installing a custom
libvips](https://sharp.pixelplumbing.com/install#custom-libvips).

**Throws** :

  * `Error` Invalid options

**Since** : 0.29.1

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.quality]| `number`| `80`| quality, integer 1-100  
[options.lossless]| `boolean`| `false`| use lossless compression mode  
[options.tileWidth]| `number`| `512`| horizontal tile size  
[options.tileHeight]| `number`| `512`| vertical tile size  
[options.chromaSubsampling]| `string`| `“‘4:4:4‘“`| set to ‘4:2:0’ to use
chroma subsampling  
  
**Example**

    
    
    // Convert any input to lossless JP2 output
    
    const data = await sharp(input)
    
      .jp2({ lossless: true })
    
      .toBuffer();

**Example**

    
    
    // Convert any input to very high quality JP2 output
    
    const data = await sharp(input)
    
      .jp2({
    
        quality: 100,
    
        chromaSubsampling: '4:4:4'
    
      })
    
      .toBuffer();

## tiff

> tiff([options]) ⇒ `Sharp`

Use these TIFF options for output image.

The `density` can be set in pixels/inch via withMetadata instead of providing
`xres` and `yres` in pixels/mm.

**Throws** :

  * `Error` Invalid options

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.quality]| `number`| `80`| quality, integer 1-100  
[options.force]| `boolean`| `true`| force TIFF output, otherwise attempt to
use input format  
[options.compression]| `string`| `“‘jpeg‘“`| compression options: none, jpeg,
deflate, packbits, ccittfax4, lzw, webp, zstd, jp2k  
[options.predictor]| `string`| `“‘horizontal‘“`| compression predictor
options: none, horizontal, float  
[options.pyramid]| `boolean`| `false`| write an image pyramid  
[options.tile]| `boolean`| `false`| write a tiled tiff  
[options.tileWidth]| `number`| `256`| horizontal tile size  
[options.tileHeight]| `number`| `256`| vertical tile size  
[options.xres]| `number`| `1.0`| horizontal resolution in pixels/mm  
[options.yres]| `number`| `1.0`| vertical resolution in pixels/mm  
[options.resolutionUnit]| `string`| `“‘inch‘“`| resolution unit options: inch,
cm  
[options.bitdepth]| `number`| `8`| reduce bitdepth to 1, 2 or 4 bit  
[options.miniswhite]| `boolean`| `false`| write 1-bit images as miniswhite  
  
**Example**

    
    
    // Convert SVG input to LZW-compressed, 1 bit per pixel TIFF output
    
    sharp('input.svg')
    
      .tiff({
    
        compression: 'lzw',
    
        bitdepth: 1
    
      })
    
      .toFile('1-bpp-output.tiff')
    
      .then(info => { ... });

## avif

> avif([options]) ⇒ `Sharp`

Use these AVIF options for output image.

AVIF image sequences are not supported. Prebuilt binaries support a bitdepth
of 8 only.

**Throws** :

  * `Error` Invalid options

**Since** : 0.27.0

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.quality]| `number`| `50`| quality, integer 1-100  
[options.lossless]| `boolean`| `false`| use lossless compression  
[options.effort]| `number`| `4`| CPU effort, between 0 (fastest) and 9
(slowest)  
[options.chromaSubsampling]| `string`| `“‘4:4:4‘“`| set to ‘4:2:0’ to use
chroma subsampling  
[options.bitdepth]| `number`| `8`| set bitdepth to 8, 10 or 12 bit  
  
**Example**

    
    
    const data = await sharp(input)
    
      .avif({ effort: 2 })
    
      .toBuffer();

**Example**

    
    
    const data = await sharp(input)
    
      .avif({ lossless: true })
    
      .toBuffer();

## heif

> heif(options) ⇒ `Sharp`

Use these HEIF options for output image.

Support for patent-encumbered HEIC images using `hevc` compression requires
the use of a globally-installed libvips compiled with support for libheif,
libde265 and x265.

**Throws** :

  * `Error` Invalid options

**Since** : 0.23.0

Param| Type| Default| Description  
---|---|---|---  
options| `Object`| | output options  
options.compression| `string`| | compression format: av1, hevc  
[options.quality]| `number`| `50`| quality, integer 1-100  
[options.lossless]| `boolean`| `false`| use lossless compression  
[options.effort]| `number`| `4`| CPU effort, between 0 (fastest) and 9
(slowest)  
[options.chromaSubsampling]| `string`| `“‘4:4:4‘“`| set to ‘4:2:0’ to use
chroma subsampling  
[options.bitdepth]| `number`| `8`| set bitdepth to 8, 10 or 12 bit  
  
**Example**

    
    
    const data = await sharp(input)
    
      .heif({ compression: 'hevc' })
    
      .toBuffer();

## jxl

> jxl([options]) ⇒ `Sharp`

Use these JPEG-XL (JXL) options for output image.

This feature is experimental, please do not use in production systems.

Requires libvips compiled with support for libjxl. The prebuilt binaries do
not include this - see [installing a custom
libvips](https://sharp.pixelplumbing.com/install#custom-libvips).

**Throws** :

  * `Error` Invalid options

**Since** : 0.31.3

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.distance]| `number`| `1.0`| maximum encoding error, between 0
(highest quality) and 15 (lowest quality)  
[options.quality]| `number`| | calculate `distance` based on JPEG-like quality, between 1 and 100, overrides distance if specified  
[options.decodingTier]| `number`| `0`| target decode speed tier, between 0
(highest quality) and 4 (lowest quality)  
[options.lossless]| `boolean`| `false`| use lossless compression  
[options.effort]| `number`| `7`| CPU effort, between 1 (fastest) and 9
(slowest)  
[options.loop]| `number`| `0`| number of animation iterations, use 0 for
infinite animation  
[options.delay]| `number` | `Array.<number>`| | delay(s) between animation frames (in milliseconds)  
  
## raw

> raw([options]) ⇒ `Sharp`

Force output to be raw, uncompressed pixel data. Pixel ordering is left-to-
right, top-to-bottom, without padding. Channel ordering will be RGB or RGBA
for non-greyscale colourspaces.

**Throws** :

  * `Error` Invalid options

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| | output options  
[options.depth]| `string`| `“‘uchar‘“`| bit depth, one of: char, uchar
(default), short, ushort, int, uint, float, complex, double, dpcomplex  
  
**Example**

    
    
    // Extract raw, unsigned 8-bit RGB pixel data from JPEG input
    
    const { data, info } = await sharp('input.jpg')
    
      .raw()
    
      .toBuffer({ resolveWithObject: true });

**Example**

    
    
    // Extract alpha channel as raw, unsigned 16-bit pixel data from PNG input
    
    const data = await sharp('input.png')
    
      .ensureAlpha()
    
      .extractChannel(3)
    
      .toColourspace('b-w')
    
      .raw({ depth: 'ushort' })
    
      .toBuffer();

## tile

> tile([options]) ⇒ `Sharp`

Use tile-based deep zoom (image pyramid) output.

Set the format and options for tile images via the `toFormat`, `jpeg`, `png`
or `webp` functions. Use a `.zip` or `.szi` file extension with `toFile` to
write to a compressed archive file format.

The container will be set to `zip` when the output is a Buffer or Stream,
otherwise it will default to `fs`.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| |   
[options.size]| `number`| `256`| tile size in pixels, a value between 1 and
8192.  
[options.overlap]| `number`| `0`| tile overlap in pixels, a value between 0
and 8192.  
[options.angle]| `number`| `0`| tile angle of rotation, must be a multiple of
90.  
[options.background]| `string` | `Object`| `”{r: 255, g: 255, b: 255, alpha: 1}“`| background colour, parsed by the [color](https://www.npmjs.org/package/color) module, defaults to white without transparency.  
[options.depth]| `string`| | how deep to make the pyramid, possible values are `onepixel`, `onetile` or `one`, default based on layout.  
[options.skipBlanks]| `number`| `-1`| Threshold to skip tile generation. Range
is 0-255 for 8-bit images, 0-65535 for 16-bit images. Default is 5 for
`google` layout, -1 (no skip) otherwise.  
[options.container]| `string`| `“‘fs‘“`| tile container, with value `fs`
(filesystem) or `zip` (compressed file).  
[options.layout]| `string`| `“‘dz‘“`| filesystem layout, possible values are
`dz`, `iiif`, `iiif3`, `zoomify` or `google`.  
[options.centre]| `boolean`| `false`| centre image in tile.  
[options.center]| `boolean`| `false`| alternative spelling of centre.  
[options.id]| `string`|
`“‘[https://example.com/iiif&#x27](https://example.com/iiif&#x27);“`| when
`layout` is `iiif`/`iiif3`, sets the `@id`/`id` attribute of `info.json`  
[options.basename]| `string`| | the name of the directory within the zip file when container is `zip`.  
  
**Example**

    
    
    sharp('input.tiff')
    
      .png()
    
      .tile({
    
        size: 512
    
      })
    
      .toFile('output.dz', function(err, info) {
    
        // output.dzi is the Deep Zoom XML definition
    
        // output_files contains 512x512 tiles grouped by zoom level
    
      });

**Example**

    
    
    const zipFileWithTiles = await sharp(input)
    
      .tile({ basename: "tiles" })
    
      .toBuffer();

**Example**

    
    
    const iiififier = sharp().tile({ layout: "iiif" });
    
    readableStream
    
      .pipe(iiififier)
    
      .pipe(writeableStream);

## timeout

> timeout(options) ⇒ `Sharp`

Set a timeout for processing, in seconds. Use a value of zero to continue
processing indefinitely, the default behaviour.

The clock starts when libvips opens an input image for processing. Time spent
waiting for a libuv thread to become available is not included.

**Since** : 0.29.2

Param| Type| Description  
---|---|---  
options| `Object`|  
options.seconds| `number`| Number of seconds after which processing will be
stopped  
  
**Example**

    
    
    // Ensure processing takes no longer than 3 seconds
    
    try {
    
      const data = await sharp(input)
    
        .blur(1000)
    
        .timeout({ seconds: 3 })
    
        .toBuffer();
    
    } catch (err) {
    
      if (err.message.includes('timeout')) { ... }
    
    }

[ Previous  
Input metadata ](/api-input/) [ Next  
Resizing images ](/api-resize/)

# Resizing images | sharp

# Resizing images

## resize

> resize([width], [height], [options]) ⇒ `Sharp`

Resize image to `width`, `height` or `width x height`.

When both a `width` and `height` are provided, the possible methods by which
the image should **fit** these are:

  * `cover`: (default) Preserving aspect ratio, attempt to ensure the image covers both provided dimensions by cropping/clipping to fit.
  * `contain`: Preserving aspect ratio, contain within both provided dimensions using “letterboxing” where necessary.
  * `fill`: Ignore the aspect ratio of the input and stretch to both provided dimensions.
  * `inside`: Preserving aspect ratio, resize the image to be as large as possible while ensuring its dimensions are less than or equal to both those specified.
  * `outside`: Preserving aspect ratio, resize the image to be as small as possible while ensuring its dimensions are greater than or equal to both those specified.

Some of these values are based on the [object-
fit](https://developer.mozilla.org/en-US/docs/Web/CSS/object-fit) CSS
property.

![Examples of various values for the fit property when
resizing](https://cdn.jsdelivr.net/gh/lovell/sharp@main/docs/public/api-
resize-fit.svg)

When using a **fit** of `cover` or `contain`, the default **position** is
`centre`. Other options are:

  * `sharp.position`: `top`, `right top`, `right`, `right bottom`, `bottom`, `left bottom`, `left`, `left top`.
  * `sharp.gravity`: `north`, `northeast`, `east`, `southeast`, `south`, `southwest`, `west`, `northwest`, `center` or `centre`.
  * `sharp.strategy`: `cover` only, dynamically crop using either the `entropy` or `attention` strategy.

Some of these values are based on the [object-
position](https://developer.mozilla.org/en-US/docs/Web/CSS/object-position)
CSS property.

The strategy-based approach initially resizes so one dimension is at its
target length then repeatedly ranks edge regions, discarding the edge with the
lowest score based on the selected strategy.

  * `entropy`: focus on the region with the highest [Shannon entropy](https://en.wikipedia.org/wiki/Entropy_%28information_theory%29).
  * `attention`: focus on the region with the highest luminance frequency, colour saturation and presence of skin tones.

Possible downsizing kernels are:

  * `nearest`: Use [nearest neighbour interpolation](https://en.wikipedia.org/wiki/Nearest-neighbor_interpolation).
  * `linear`: Use a [triangle filter](https://en.wikipedia.org/wiki/Triangular_function).
  * `cubic`: Use a [Catmull-Rom spline](https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline).
  * `mitchell`: Use a [Mitchell-Netravali spline](https://www.cs.utexas.edu/~fussell/courses/cs384g-fall2013/lectures/mitchell/Mitchell.pdf).
  * `lanczos2`: Use a [Lanczos kernel](https://en.wikipedia.org/wiki/Lanczos_resampling#Lanczos_kernel) with `a=2`.
  * `lanczos3`: Use a Lanczos kernel with `a=3` (the default).

When upsampling, these kernels map to `nearest`, `linear` and `cubic`
interpolators. Downsampling kernels without a matching upsampling interpolator
map to `cubic`.

Only one resize can occur per pipeline. Previous calls to `resize` in the same
pipeline will be ignored.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[width]| `number`| | How many pixels wide the resultant image should be. Use `null` or `undefined` to auto-scale the width to match the height.  
[height]| `number`| | How many pixels high the resultant image should be. Use `null` or `undefined` to auto-scale the height to match the width.  
[options]| `Object`| |   
[options.width]| `number`| | An alternative means of specifying `width`. If both are present this takes priority.  
[options.height]| `number`| | An alternative means of specifying `height`. If both are present this takes priority.  
[options.fit]| `String`| `’cover’`| How the image should be resized/cropped to
fit the target dimension(s), one of `cover`, `contain`, `fill`, `inside` or
`outside`.  
[options.position]| `String`| `’centre’`| A position, gravity or strategy to
use when `fit` is `cover` or `contain`.  
[options.background]| `String` | `Object`| `{r: 0, g: 0, b: 0, alpha: 1}`| background colour when `fit` is `contain`, parsed by the [color](https://www.npmjs.org/package/color) module, defaults to black without transparency.  
[options.kernel]| `String`| `’lanczos3’`| The kernel to use for image
reduction and the inferred interpolator to use for upsampling. Use the
`fastShrinkOnLoad` option to control kernel vs shrink-on-load.  
[options.withoutEnlargement]| `Boolean`| `false`| Do not scale up if the width
_or_ height are already less than the target dimensions, equivalent to
GraphicsMagick’s `>` geometry option. This may result in output dimensions
smaller than the target dimensions.  
[options.withoutReduction]| `Boolean`| `false`| Do not scale down if the width
_or_ height are already greater than the target dimensions, equivalent to
GraphicsMagick’s `<` geometry option. This may still result in a crop to reach
the target dimensions.  
[options.fastShrinkOnLoad]| `Boolean`| `true`| Take greater advantage of the
JPEG and WebP shrink-on-load feature, which can lead to a slight moiré pattern
or round-down of an auto-scaled dimension.  
  
**Example**

    
    
    sharp(input)
    
      .resize({ width: 100 })
    
      .toBuffer()
    
      .then(data => {
    
        // 100 pixels wide, auto-scaled height
    
      });

**Example**

    
    
    sharp(input)
    
      .resize({ height: 100 })
    
      .toBuffer()
    
      .then(data => {
    
        // 100 pixels high, auto-scaled width
    
      });

**Example**

    
    
    sharp(input)
    
      .resize(200, 300, {
    
        kernel: sharp.kernel.nearest,
    
        fit: 'contain',
    
        position: 'right top',
    
        background: { r: 255, g: 255, b: 255, alpha: 0.5 }
    
      })
    
      .toFile('output.png')
    
      .then(() => {
    
        // output.png is a 200 pixels wide and 300 pixels high image
    
        // containing a nearest-neighbour scaled version
    
        // contained within the north-east corner of a semi-transparent white canvas
    
      });

**Example**

    
    
    const transformer = sharp()
    
      .resize({
    
        width: 200,
    
        height: 200,
    
        fit: sharp.fit.cover,
    
        position: sharp.strategy.entropy
    
      });
    
    // Read image data from readableStream
    
    // Write 200px square auto-cropped image data to writableStream
    
    readableStream
    
      .pipe(transformer)
    
      .pipe(writableStream);

**Example**

    
    
    sharp(input)
    
      .resize(200, 200, {
    
        fit: sharp.fit.inside,
    
        withoutEnlargement: true
    
      })
    
      .toFormat('jpeg')
    
      .toBuffer()
    
      .then(function(outputBuffer) {
    
        // outputBuffer contains JPEG image data
    
        // no wider and no higher than 200 pixels
    
        // and no larger than the input image
    
      });

**Example**

    
    
    sharp(input)
    
      .resize(200, 200, {
    
        fit: sharp.fit.outside,
    
        withoutReduction: true
    
      })
    
      .toFormat('jpeg')
    
      .toBuffer()
    
      .then(function(outputBuffer) {
    
        // outputBuffer contains JPEG image data
    
        // of at least 200 pixels wide and 200 pixels high while maintaining aspect ratio
    
        // and no smaller than the input image
    
      });

**Example**

    
    
    const scaleByHalf = await sharp(input)
    
      .metadata()
    
      .then(({ width }) => sharp(input)
    
        .resize(Math.round(width * 0.5))
    
        .toBuffer()
    
      );

## extend

> extend(extend) ⇒ `Sharp`

Extend / pad / extrude one or more edges of the image with either the provided
background colour or pixels derived from the image. This operation will always
occur after resizing and extraction, if any.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
extend| `number` | `Object`| | single pixel count to add to all edges or an Object with per-edge counts  
[extend.top]| `number`| `0`|  
[extend.left]| `number`| `0`|  
[extend.bottom]| `number`| `0`|  
[extend.right]| `number`| `0`|  
[extend.extendWith]| `String`| `’background’`| populate new pixels using this
method, one of: background, copy, repeat, mirror.  
[extend.background]| `String` | `Object`| `{r: 0, g: 0, b: 0, alpha: 1}`| background colour, parsed by the [color](https://www.npmjs.org/package/color) module, defaults to black without transparency.  
  
**Example**

    
    
    // Resize to 140 pixels wide, then add 10 transparent pixels
    
    // to the top, left and right edges and 20 to the bottom edge
    
    sharp(input)
    
      .resize(140)
    
      .extend({
    
        top: 10,
    
        bottom: 20,
    
        left: 10,
    
        right: 10,
    
        background: { r: 0, g: 0, b: 0, alpha: 0 }
    
      })
    
      ...

**Example**

    
    
    // Add a row of 10 red pixels to the bottom
    
    sharp(input)
    
      .extend({
    
        bottom: 10,
    
        background: 'red'
    
      })
    
      ...

**Example**

    
    
    // Extrude image by 8 pixels to the right, mirroring existing right hand edge
    
    sharp(input)
    
      .extend({
    
        right: 8,
    
        background: 'mirror'
    
      })
    
      ...

## extract

> extract(options) ⇒ `Sharp`

Extract/crop a region of the image.

  * Use `extract` before `resize` for pre-resize extraction.
  * Use `extract` after `resize` for post-resize extraction.
  * Use `extract` twice and `resize` once for extract-then-resize-then-extract in a fixed operation order.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
options| `Object`| describes the region to extract using integral pixel values  
options.left| `number`| zero-indexed offset from left edge  
options.top| `number`| zero-indexed offset from top edge  
options.width| `number`| width of region to extract  
options.height| `number`| height of region to extract  
  
**Example**

    
    
    sharp(input)
    
      .extract({ left: left, top: top, width: width, height: height })
    
      .toFile(output, function(err) {
    
        // Extract a region of the input image, saving in the same format.
    
      });

**Example**

    
    
    sharp(input)
    
      .extract({ left: leftOffsetPre, top: topOffsetPre, width: widthPre, height: heightPre })
    
      .resize(width, height)
    
      .extract({ left: leftOffsetPost, top: topOffsetPost, width: widthPost, height: heightPost })
    
      .toFile(output, function(err) {
    
        // Extract a region, resize, then extract from the resized image
    
      });

## trim

> trim([options]) ⇒ `Sharp`

Trim pixels from all edges that contain values similar to the given background
colour, which defaults to that of the top-left pixel.

Images with an alpha channel will use the combined bounding box of alpha and
non-alpha channels.

If the result of this operation would trim an image to nothing then no change
is made.

The `info` response Object will contain `trimOffsetLeft` and `trimOffsetTop`
properties.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| |   
[options.background]| `string` | `Object`| `“‘top-left pixel‘“`| Background colour, parsed by the [color](https://www.npmjs.org/package/color) module, defaults to that of the top-left pixel.  
[options.threshold]| `number`| `10`| Allowed difference from the above colour,
a positive number.  
[options.lineArt]| `boolean`| `false`| Does the input more closely resemble
line art (e.g. vector) rather than being photographic?  
  
**Example**

    
    
    // Trim pixels with a colour similar to that of the top-left pixel.
    
    await sharp(input)
    
      .trim()
    
      .toFile(output);

**Example**

    
    
    // Trim pixels with the exact same colour as that of the top-left pixel.
    
    await sharp(input)
    
      .trim({
    
        threshold: 0
    
      })
    
      .toFile(output);

**Example**

    
    
    // Assume input is line art and trim only pixels with a similar colour to red.
    
    const output = await sharp(input)
    
      .trim({
    
        background: "#FF0000",
    
        lineArt: true
    
      })
    
      .toBuffer();

**Example**

    
    
    // Trim all "yellow-ish" pixels, being more lenient with the higher threshold.
    
    const output = await sharp(input)
    
      .trim({
    
        background: "yellow",
    
        threshold: 42,
    
      })
    
      .toBuffer();

[ Previous  
Output options ](/api-output/) [ Next  
Compositing images ](/api-composite/)

# Compositing images | sharp

# Compositing images

## composite

> composite(images) ⇒ `Sharp`

Composite image(s) over the processed (resized, extracted etc.) image.

The images to composite must be the same size or smaller than the processed
image. If both `top` and `left` options are provided, they take precedence
over `gravity`.

Other operations in the same processing pipeline (e.g. resize, rotate, flip,
flop, extract) will always be applied to the input image before composition.

The `blend` option can be one of `clear`, `source`, `over`, `in`, `out`,
`atop`, `dest`, `dest-over`, `dest-in`, `dest-out`, `dest-atop`, `xor`, `add`,
`saturate`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `colour-
dodge`, `color-dodge`, `colour-burn`,`color-burn`, `hard-light`, `soft-light`,
`difference`, `exclusion`.

More information about blend modes can be found at
<https://www.libvips.org/API/current/libvips-conversion.html#VipsBlendMode>
and <https://www.cairographics.org/operators/>

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.22.0

Param| Type| Default| Description  
---|---|---|---  
images| `Array.<Object>`| | Ordered list of images to composite  
[images[].input]| `Buffer` | `String`| | Buffer containing image data, String containing the path to an image file, or Create object (see below)  
[images[].input.create]| `Object`| | describes a blank overlay to be created.  
[images[].input.create.width]| `Number`| |   
[images[].input.create.height]| `Number`| |   
[images[].input.create.channels]| `Number`| | 3-4  
[images[].input.create.background]| `String` | `Object`| | parsed by the [color](https://www.npmjs.org/package/color) module to extract values for red, green, blue and alpha.  
[images[].input.text]| `Object`| | describes a new text image to be created.  
[images[].input.text.text]| `string`| | text to render as a UTF-8 string. It can contain Pango markup, for example `<i>Le</i>Monde`.  
[images[].input.text.font]| `string`| | font name to render with.  
[images[].input.text.fontfile]| `string`| | absolute filesystem path to a font file that can be used by `font`.  
[images[].input.text.width]| `number`| `0`| integral number of pixels to word-
wrap at. Lines of text wider than this will be broken at word boundaries.  
[images[].input.text.height]| `number`| `0`| integral number of pixels high.
When defined, `dpi` will be ignored and the text will automatically fit the
pixel resolution defined by `width` and `height`. Will be ignored if `width`
is not specified or set to 0.  
[images[].input.text.align]| `string`| `“‘left‘“`| text alignment (`'left'`,
`'centre'`, `'center'`, `'right'`).  
[images[].input.text.justify]| `boolean`| `false`| set this to true to apply
justification to the text.  
[images[].input.text.dpi]| `number`| `72`| the resolution (size) at which to
render the text. Does not take effect if `height` is specified.  
[images[].input.text.rgba]| `boolean`| `false`| set this to true to enable
RGBA output. This is useful for colour emoji rendering, or support for Pango
markup features like `<span foreground="red">Red!</span>`.  
[images[].input.text.spacing]| `number`| `0`| text line height in points. Will
use the font line height if none is specified.  
[images[].autoOrient]| `Boolean`| `false`| set to true to use EXIF orientation
data, if present, to orient the image.  
[images[].blend]| `String`| `’over’`| how to blend this image with the image
below.  
[images[].gravity]| `String`| `’centre’`| gravity at which to place the
overlay.  
[images[].top]| `Number`| | the pixel offset from the top edge.  
[images[].left]| `Number`| | the pixel offset from the left edge.  
[images[].tile]| `Boolean`| `false`| set to true to repeat the overlay image
across the entire image with the given `gravity`.  
[images[].premultiplied]| `Boolean`| `false`| set to true to avoid
premultiplying the image below. Equivalent to the `--premultiplied` vips
option.  
[images[].density]| `Number`| `72`| number representing the DPI for vector
overlay image.  
[images[].raw]| `Object`| | describes overlay when using raw pixel data.  
[images[].raw.width]| `Number`| |   
[images[].raw.height]| `Number`| |   
[images[].raw.channels]| `Number`| |   
[images[].animated]| `boolean`| `false`| Set to `true` to read all
frames/pages of an animated image.  
[images[].failOn]| `string`| `“‘warning’“`| @see [constructor
parameters](/api-constructor#parameters)  
[images[].limitInputPixels]| `number` | `boolean`| `268402689`| @see [constructor parameters](/api-constructor#parameters)  
  
**Example**

    
    
    await sharp(background)
    
      .composite([
    
        { input: layer1, gravity: 'northwest' },
    
        { input: layer2, gravity: 'southeast' },
    
      ])
    
      .toFile('combined.png');

**Example**

    
    
    const output = await sharp('input.gif', { animated: true })
    
      .composite([
    
        { input: 'overlay.png', tile: true, blend: 'saturate' }
    
      ])
    
      .toBuffer();

**Example**

    
    
    sharp('input.png')
    
      .rotate(180)
    
      .resize(300)
    
      .flatten( { background: '#ff6600' } )
    
      .composite([{ input: 'overlay.png', gravity: 'southeast' }])
    
      .sharpen()
    
      .withMetadata()
    
      .webp( { quality: 90 } )
    
      .toBuffer()
    
      .then(function(outputBuffer) {
    
        // outputBuffer contains upside down, 300px wide, alpha channel flattened
    
        // onto orange background, composited with overlay.png with SE gravity,
    
        // sharpened, with metadata, 90% quality WebP image data. Phew!
    
      });

[ Previous  
Resizing images ](/api-resize/) [ Next  
Image operations ](/api-operation/)

# Image operations | sharp

# Image operations

## rotate

> rotate([angle], [options]) ⇒ `Sharp`

Rotate the output image.

The provided angle is converted to a valid positive degree rotation. For
example, `-450` will produce a 270 degree rotation.

When rotating by an angle other than a multiple of 90, the background colour
can be provided with the `background` option.

For backwards compatibility, if no angle is provided, `.autoOrient()` will be
called.

Only one rotation can occur per pipeline (aside from an initial call without
arguments to orient via EXIF data). Previous calls to `rotate` in the same
pipeline will be ignored.

Multi-page images can only be rotated by 180 degrees.

Method order is important when rotating, resizing and/or extracting regions,
for example `.rotate(x).extract(y)` will produce a different result to
`.extract(y).rotate(x)`.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[angle]| `number`| `auto`| angle of rotation.  
[options]| `Object`| | if present, is an Object with optional attributes.  
[options.background]| `string` | `Object`| `”&quot;#000000&quot;“`| parsed by the [color](https://www.npmjs.org/package/color) module to extract values for red, green, blue and alpha.  
  
**Example**

    
    
    const rotateThenResize = await sharp(input)
    
      .rotate(90)
    
      .resize({ width: 16, height: 8, fit: 'fill' })
    
      .toBuffer();
    
    const resizeThenRotate = await sharp(input)
    
      .resize({ width: 16, height: 8, fit: 'fill' })
    
      .rotate(90)
    
      .toBuffer();

## autoOrient

> autoOrient() ⇒ `Sharp`

Auto-orient based on the EXIF `Orientation` tag, then remove the tag.
Mirroring is supported and may infer the use of a flip operation.

Previous or subsequent use of `rotate(angle)` and either `flip()` or `flop()`
will logically occur after auto-orientation, regardless of call order.

**Example**

    
    
    const output = await sharp(input).autoOrient().toBuffer();

**Example**

    
    
    const pipeline = sharp()
    
      .autoOrient()
    
      .resize(null, 200)
    
      .toBuffer(function (err, outputBuffer, info) {
    
        // outputBuffer contains 200px high JPEG image data,
    
        // auto-oriented using EXIF Orientation tag
    
        // info.width and info.height contain the dimensions of the resized image
    
      });
    
    readableStream.pipe(pipeline);

## flip

> flip([flip]) ⇒ `Sharp`

Mirror the image vertically (up-down) about the x-axis. This always occurs
before rotation, if any.

This operation does not work correctly with multi-page images.

Param| Type| Default  
---|---|---  
[flip]| `Boolean`| `true`  
  
**Example**

    
    
    const output = await sharp(input).flip().toBuffer();

## flop

> flop([flop]) ⇒ `Sharp`

Mirror the image horizontally (left-right) about the y-axis. This always
occurs before rotation, if any.

Param| Type| Default  
---|---|---  
[flop]| `Boolean`| `true`  
  
**Example**

    
    
    const output = await sharp(input).flop().toBuffer();

## affine

> affine(matrix, [options]) ⇒ `Sharp`

Perform an affine transform on an image. This operation will always occur
after resizing, extraction and rotation, if any.

You must provide an array of length 4 or a 2x2 affine transformation matrix.
By default, new pixels are filled with a black background. You can provide a
background colour with the `background` option. A particular interpolator may
also be specified. Set the `interpolator` option to an attribute of the
`sharp.interpolators` Object e.g. `sharp.interpolators.nohalo`.

In the case of a 2x2 matrix, the transform is:

  * X = `matrix[0, 0]` * (x + `idx`) + `matrix[0, 1]` * (y + `idy`) + `odx`
  * Y = `matrix[1, 0]` * (x + `idx`) + `matrix[1, 1]` * (y + `idy`) + `ody`

where:

  * x and y are the coordinates in input image.
  * X and Y are the coordinates in output image.
  * (0,0) is the upper left corner.

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.27.0

Param| Type| Default| Description  
---|---|---|---  
matrix| `Array.<Array.<number>>` | `Array.<number>`| | affine transformation matrix  
[options]| `Object`| | if present, is an Object with optional attributes.  
[options.background]| `String` | `Object`| `”#000000”`| parsed by the [color](https://www.npmjs.org/package/color) module to extract values for red, green, blue and alpha.  
[options.idx]| `Number`| `0`| input horizontal offset  
[options.idy]| `Number`| `0`| input vertical offset  
[options.odx]| `Number`| `0`| output horizontal offset  
[options.ody]| `Number`| `0`| output vertical offset  
[options.interpolator]| `String`| `sharp.interpolators.bicubic`| interpolator  
  
**Example**

    
    
    const pipeline = sharp()
    
      .affine([[1, 0.3], [0.1, 0.7]], {
    
         background: 'white',
    
         interpolator: sharp.interpolators.nohalo
    
      })
    
      .toBuffer((err, outputBuffer, info) => {
    
         // outputBuffer contains the transformed image
    
         // info.width and info.height contain the new dimensions
    
      });
    
    
    
    
    inputStream
    
      .pipe(pipeline);

## sharpen

> sharpen([options], [flat], [jagged]) ⇒ `Sharp`

Sharpen the image.

When used without parameters, performs a fast, mild sharpen of the output
image.

When a `sigma` is provided, performs a slower, more accurate sharpen of the L
channel in the LAB colour space. Fine-grained control over the level of
sharpening in “flat” (m1) and “jagged” (m2) areas is available.

See [libvips sharpen](https://www.libvips.org/API/current/libvips-
convolution.html#vips-sharpen) operation.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object` | `number`| | if present, is an Object with attributes  
[options.sigma]| `number`| | the sigma of the Gaussian mask, where `sigma = 1 + radius / 2`, between 0.000001 and 10  
[options.m1]| `number`| `1.0`| the level of sharpening to apply to “flat”
areas, between 0 and 1000000  
[options.m2]| `number`| `2.0`| the level of sharpening to apply to “jagged”
areas, between 0 and 1000000  
[options.x1]| `number`| `2.0`| threshold between “flat” and “jagged”, between
0 and 1000000  
[options.y2]| `number`| `10.0`| maximum amount of brightening, between 0 and
1000000  
[options.y3]| `number`| `20.0`| maximum amount of darkening, between 0 and
1000000  
[flat]| `number`| | (deprecated) see `options.m1`.  
[jagged]| `number`| | (deprecated) see `options.m2`.  
  
**Example**

    
    
    const data = await sharp(input).sharpen().toBuffer();

**Example**

    
    
    const data = await sharp(input).sharpen({ sigma: 2 }).toBuffer();

**Example**

    
    
    const data = await sharp(input)
    
      .sharpen({
    
        sigma: 2,
    
        m1: 0,
    
        m2: 3,
    
        x1: 3,
    
        y2: 15,
    
        y3: 15,
    
      })
    
      .toBuffer();

## median

> median([size]) ⇒ `Sharp`

Apply median filter. When used without parameters the default window is 3x3.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[size]| `number`| `3`| square mask size: size x size  
  
**Example**

    
    
    const output = await sharp(input).median().toBuffer();

**Example**

    
    
    const output = await sharp(input).median(5).toBuffer();

## blur

> blur([options]) ⇒ `Sharp`

Blur the image.

When used without parameters, performs a fast 3x3 box blur (equivalent to a
box linear filter).

When a `sigma` is provided, performs a slower, more accurate Gaussian blur.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object` | `number` | `Boolean`| |   
[options.sigma]| `number`| | a value between 0.3 and 1000 representing the sigma of the Gaussian mask, where `sigma = 1 + radius / 2`.  
[options.precision]| `string`| `“‘integer‘“`| How accurate the operation
should be, one of: integer, float, approximate.  
[options.minAmplitude]| `number`| `0.2`| A value between 0.001 and 1. A
smaller value will generate a larger, more accurate mask.  
  
**Example**

    
    
    const boxBlurred = await sharp(input)
    
      .blur()
    
      .toBuffer();

**Example**

    
    
    const gaussianBlurred = await sharp(input)
    
      .blur(5)
    
      .toBuffer();

## dilate

> dilate([width]) ⇒ `Sharp`

Expand foreground objects using the dilate morphological operator.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[width]| `Number`| `1`| dilation width in pixels.  
  
**Example**

    
    
    const output = await sharp(input)
    
      .dilate()
    
      .toBuffer();

## erode

> erode([width]) ⇒ `Sharp`

Shrink foreground objects using the erode morphological operator.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[width]| `Number`| `1`| erosion width in pixels.  
  
**Example**

    
    
    const output = await sharp(input)
    
      .erode()
    
      .toBuffer();

## flatten

> flatten([options]) ⇒ `Sharp`

Merge alpha transparency channel, if any, with a background, then remove the
alpha channel.

See also [removeAlpha](/api-channel#removealpha).

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| |   
[options.background]| `string` | `Object`| `”{r: 0, g: 0, b: 0}“`| background colour, parsed by the [color](https://www.npmjs.org/package/color) module, defaults to black.  
  
**Example**

    
    
    await sharp(rgbaInput)
    
      .flatten({ background: '#F0A703' })
    
      .toBuffer();

## unflatten

> unflatten()

Ensure the image has an alpha channel with all white pixel values made fully
transparent.

Existing alpha channel values for non-white pixels remain unchanged.

This feature is experimental and the API may change.

**Since** : 0.32.1  
**Example**

    
    
    await sharp(rgbInput)
    
      .unflatten()
    
      .toBuffer();

**Example**

    
    
    await sharp(rgbInput)
    
      .threshold(128, { grayscale: false }) // converter bright pixels to white
    
      .unflatten()
    
      .toBuffer();

## gamma

> gamma([gamma], [gammaOut]) ⇒ `Sharp`

Apply a gamma correction by reducing the encoding (darken) pre-resize at a
factor of `1/gamma` then increasing the encoding (brighten) post-resize at a
factor of `gamma`. This can improve the perceived brightness of a resized
image in non-linear colour spaces. JPEG and WebP input images will not take
advantage of the shrink-on-load performance optimisation when applying a gamma
correction.

Supply a second argument to use a different output gamma value, otherwise the
first value is used in both cases.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[gamma]| `number`| `2.2`| value between 1.0 and 3.0.  
[gammaOut]| `number`| | value between 1.0 and 3.0. (optional, defaults to same as `gamma`)  
  
## negate

> negate([options]) ⇒ `Sharp`

Produce the “negative” of the image.

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| |   
[options.alpha]| `Boolean`| `true`| Whether or not to negate any alpha channel  
  
**Example**

    
    
    const output = await sharp(input)
    
      .negate()
    
      .toBuffer();

**Example**

    
    
    const output = await sharp(input)
    
      .negate({ alpha: false })
    
      .toBuffer();

## normalise

> normalise([options]) ⇒ `Sharp`

Enhance output image contrast by stretching its luminance to cover a full
dynamic range.

Uses a histogram-based approach, taking a default range of 1% to 99% to reduce
sensitivity to noise at the extremes.

Luminance values below the `lower` percentile will be underexposed by clipping
to zero. Luminance values above the `upper` percentile will be overexposed by
clipping to the max pixel value.

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| |   
[options.lower]| `number`| `1`| Percentile below which luminance values will
be underexposed.  
[options.upper]| `number`| `99`| Percentile above which luminance values will
be overexposed.  
  
**Example**

    
    
    const output = await sharp(input)
    
      .normalise()
    
      .toBuffer();

**Example**

    
    
    const output = await sharp(input)
    
      .normalise({ lower: 0, upper: 100 })
    
      .toBuffer();

## normalize

> normalize([options]) ⇒ `Sharp`

Alternative spelling of normalise.

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object`| |   
[options.lower]| `number`| `1`| Percentile below which luminance values will
be underexposed.  
[options.upper]| `number`| `99`| Percentile above which luminance values will
be overexposed.  
  
**Example**

    
    
    const output = await sharp(input)
    
      .normalize()
    
      .toBuffer();

## clahe

> clahe(options) ⇒ `Sharp`

Perform contrast limiting adaptive histogram equalization
[CLAHE](https://en.wikipedia.org/wiki/Adaptive_histogram_equalization#Contrast_Limited_AHE).

This will, in general, enhance the clarity of the image by bringing out darker
details.

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.28.3

Param| Type| Default| Description  
---|---|---|---  
options| `Object`| |   
options.width| `number`| | Integral width of the search window, in pixels.  
options.height| `number`| | Integral height of the search window, in pixels.  
[options.maxSlope]| `number`| `3`| Integral level of brightening, between 0
and 100, where 0 disables contrast limiting.  
  
**Example**

    
    
    const output = await sharp(input)
    
      .clahe({
    
        width: 3,
    
        height: 3,
    
      })
    
      .toBuffer();

## convolve

> convolve(kernel) ⇒ `Sharp`

Convolve the image with the specified kernel.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
kernel| `Object`| |   
kernel.width| `number`| | width of the kernel in pixels.  
kernel.height| `number`| | height of the kernel in pixels.  
kernel.kernel| `Array.<number>`| | Array of length `width*height` containing the kernel values.  
[kernel.scale]| `number`| `sum`| the scale of the kernel in pixels.  
[kernel.offset]| `number`| `0`| the offset of the kernel in pixels.  
  
**Example**

    
    
    sharp(input)
    
      .convolve({
    
        width: 3,
    
        height: 3,
    
        kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1]
    
      })
    
      .raw()
    
      .toBuffer(function(err, data, info) {
    
        // data contains the raw pixel data representing the convolution
    
        // of the input image with the horizontal Sobel operator
    
      });

## threshold

> threshold([threshold], [options]) ⇒ `Sharp`

Any pixel value greater than or equal to the threshold value will be set to
255, otherwise it will be set to 0.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[threshold]| `number`| `128`| a value in the range 0-255 representing the
level at which the threshold will be applied.  
[options]| `Object`| |   
[options.greyscale]| `Boolean`| `true`| convert to single channel greyscale.  
[options.grayscale]| `Boolean`| `true`| alternative spelling for greyscale.  
  
## boolean

> boolean(operand, operator, [options]) ⇒ `Sharp`

Perform a bitwise boolean operation with operand image.

This operation creates an output image where each pixel is the result of the
selected bitwise boolean `operation` between the corresponding pixels of the
input images.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
operand| `Buffer` | `string`| Buffer containing image data or string containing the path to an image file.  
operator| `string`| one of `and`, `or` or `eor` to perform that bitwise
operation, like the C logic operators `&`, `  
[options]| `Object`|  
[options.raw]| `Object`| describes operand when using raw pixel data.  
[options.raw.width]| `number`|  
[options.raw.height]| `number`|  
[options.raw.channels]| `number`|  
  
## linear

> linear([a], [b]) ⇒ `Sharp`

Apply the linear formula `a` * input + `b` to the image to adjust image
levels.

When a single number is provided, it will be used for all image channels. When
an array of numbers is provided, the array length must match the number of
channels.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Default| Description  
---|---|---|---  
[a]| `number` | `Array.<number>`| `[]`| multiplier  
[b]| `number` | `Array.<number>`| `[]`| offset  
  
**Example**

    
    
    await sharp(input)
    
      .linear(0.5, 2)
    
      .toBuffer();

**Example**

    
    
    await sharp(rgbInput)
    
      .linear(
    
        [0.25, 0.5, 0.75],
    
        [150, 100, 50]
    
      )
    
      .toBuffer();

## recomb

> recomb(inputMatrix) ⇒ `Sharp`

Recombine the image with the specified matrix.

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.21.1

Param| Type| Description  
---|---|---  
inputMatrix| `Array.<Array.<number>>`| 3x3 or 4x4 Recombination matrix  
  
**Example**

    
    
    sharp(input)
    
      .recomb([
    
       [0.3588, 0.7044, 0.1368],
    
       [0.2990, 0.5870, 0.1140],
    
       [0.2392, 0.4696, 0.0912],
    
      ])
    
      .raw()
    
      .toBuffer(function(err, data, info) {
    
        // data contains the raw pixel data after applying the matrix
    
        // With this example input, a sepia filter has been applied
    
      });

## modulate

> modulate([options]) ⇒ `Sharp`

Transforms the image using brightness, saturation, hue rotation, and
lightness. Brightness and lightness both operate on luminance, with the
difference being that brightness is multiplicative whereas lightness is
additive.

**Since** : 0.22.1

Param| Type| Description  
---|---|---  
[options]| `Object`|  
[options.brightness]| `number`| Brightness multiplier  
[options.saturation]| `number`| Saturation multiplier  
[options.hue]| `number`| Degrees for hue rotation  
[options.lightness]| `number`| Lightness addend  
  
**Example**

    
    
    // increase brightness by a factor of 2
    
    const output = await sharp(input)
    
      .modulate({
    
        brightness: 2
    
      })
    
      .toBuffer();

**Example**

    
    
    // hue-rotate by 180 degrees
    
    const output = await sharp(input)
    
      .modulate({
    
        hue: 180
    
      })
    
      .toBuffer();

**Example**

    
    
    // increase lightness by +50
    
    const output = await sharp(input)
    
      .modulate({
    
        lightness: 50
    
      })
    
      .toBuffer();

**Example**

    
    
    // decrease brightness and saturation while also hue-rotating by 90 degrees
    
    const output = await sharp(input)
    
      .modulate({
    
        brightness: 0.5,
    
        saturation: 0.5,
    
        hue: 90,
    
      })
    
      .toBuffer();

[ Previous  
Compositing images ](/api-composite/) [ Next  
Colour manipulation ](/api-colour/)

# Colour manipulation | sharp

# Colour manipulation

## tint

> tint(tint) ⇒ `Sharp`

Tint the image using the provided colour. An alpha channel may be present and
will be unchanged by the operation.

**Throws** :

  * `Error` Invalid parameter

Param| Type| Description  
---|---|---  
tint| `string` | `Object`| Parsed by the [color](https://www.npmjs.org/package/color) module.  
  
**Example**

    
    
    const output = await sharp(input)
    
      .tint({ r: 255, g: 240, b: 16 })
    
      .toBuffer();

## greyscale

> greyscale([greyscale]) ⇒ `Sharp`

Convert to 8-bit greyscale; 256 shades of grey. This is a linear operation. If
the input image is in a non-linear colour space such as sRGB, use `gamma()`
with `greyscale()` for the best results. By default the output image will be
web-friendly sRGB and contain three (identical) colour channels. This may be
overridden by other sharp operations such as `toColourspace('b-w')`, which
will produce an output image containing one colour channel. An alpha channel
may be present, and will be unchanged by the operation.

Param| Type| Default  
---|---|---  
[greyscale]| `Boolean`| `true`  
  
**Example**

    
    
    const output = await sharp(input).greyscale().toBuffer();

## grayscale

> grayscale([grayscale]) ⇒ `Sharp`

Alternative spelling of `greyscale`.

Param| Type| Default  
---|---|---  
[grayscale]| `Boolean`| `true`  
  
## pipelineColourspace

> pipelineColourspace([colourspace]) ⇒ `Sharp`

Set the pipeline colourspace.

The input image will be converted to the provided colourspace at the start of
the pipeline. All operations will use this colourspace before converting to
the output colourspace, as defined by toColourspace.

**Throws** :

  * `Error` Invalid parameters

**Since** : 0.29.0

Param| Type| Description  
---|---|---  
[colourspace]| `string`| pipeline colourspace e.g. `rgb16`, `scrgb`, `lab`,
`grey16`
[…](https://github.com/libvips/libvips/blob/41cff4e9d0838498487a00623462204eb10ee5b8/libvips/iofuncs/enumtypes.c#L774)  
  
**Example**

    
    
    // Run pipeline in 16 bits per channel RGB while converting final result to 8 bits per channel sRGB.
    
    await sharp(input)
    
     .pipelineColourspace('rgb16')
    
     .toColourspace('srgb')
    
     .toFile('16bpc-pipeline-to-8bpc-output.png')

## pipelineColorspace

> pipelineColorspace([colorspace]) ⇒ `Sharp`

Alternative spelling of `pipelineColourspace`.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
[colorspace]| `string`| pipeline colorspace.  
  
## toColourspace

> toColourspace([colourspace]) ⇒ `Sharp`

Set the output colourspace. By default output image will be web-friendly sRGB,
with additional channels interpreted as alpha channels.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
[colourspace]| `string`| output colourspace e.g. `srgb`, `rgb`, `cmyk`, `lab`,
`b-w`
[…](https://github.com/libvips/libvips/blob/3c0bfdf74ce1dc37a6429bed47fa76f16e2cd70a/libvips/iofuncs/enumtypes.c#L777-L794)  
  
**Example**

    
    
    // Output 16 bits per pixel RGB
    
    await sharp(input)
    
     .toColourspace('rgb16')
    
     .toFile('16-bpp.png')

## toColorspace

> toColorspace([colorspace]) ⇒ `Sharp`

Alternative spelling of `toColourspace`.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
[colorspace]| `string`| output colorspace.  
  
[ Previous  
Image operations ](/api-operation/) [ Next  
Channel manipulation ](/api-channel/)

# Channel manipulation | sharp

# Channel manipulation

## removeAlpha

> removeAlpha() ⇒ `Sharp`

Remove alpha channels, if any. This is a no-op if the image does not have an
alpha channel.

See also [flatten](/api-operation#flatten).

**Example**

    
    
    sharp('rgba.png')
    
      .removeAlpha()
    
      .toFile('rgb.png', function(err, info) {
    
        // rgb.png is a 3 channel image without an alpha channel
    
      });

## ensureAlpha

> ensureAlpha([alpha]) ⇒ `Sharp`

Ensure the output image has an alpha transparency channel. If missing, the
added alpha channel will have the specified transparency level, defaulting to
fully-opaque (1). This is a no-op if the image already has an alpha channel.

**Throws** :

  * `Error` Invalid alpha transparency level

**Since** : 0.21.2

Param| Type| Default| Description  
---|---|---|---  
[alpha]| `number`| `1`| alpha transparency level (0=fully-transparent,
1=fully-opaque)  
  
**Example**

    
    
    // rgba.png will be a 4 channel image with a fully-opaque alpha channel
    
    await sharp('rgb.jpg')
    
      .ensureAlpha()
    
      .toFile('rgba.png')

**Example**

    
    
    // rgba is a 4 channel image with a fully-transparent alpha channel
    
    const rgba = await sharp(rgb)
    
      .ensureAlpha(0)
    
      .toBuffer();

## extractChannel

> extractChannel(channel) ⇒ `Sharp`

Extract a single channel from a multi-channel image.

**Throws** :

  * `Error` Invalid channel

Param| Type| Description  
---|---|---  
channel| `number` | `string`| zero-indexed channel/band number to extract, or `red`, `green`, `blue` or `alpha`.  
  
**Example**

    
    
    // green.jpg is a greyscale image containing the green channel of the input
    
    await sharp(input)
    
      .extractChannel('green')
    
      .toFile('green.jpg');

**Example**

    
    
    // red1 is the red value of the first pixel, red2 the second pixel etc.
    
    const [red1, red2, ...] = await sharp(input)
    
      .extractChannel(0)
    
      .raw()
    
      .toBuffer();

## joinChannel

> joinChannel(images, options) ⇒ `Sharp`

Join one or more channels to the image. The meaning of the added channels
depends on the output colourspace, set with `toColourspace()`. By default the
output image will be web-friendly sRGB, with additional channels interpreted
as alpha channels. Channel ordering follows vips convention:

  * sRGB: 0: Red, 1: Green, 2: Blue, 3: Alpha.
  * CMYK: 0: Magenta, 1: Cyan, 2: Yellow, 3: Black, 4: Alpha.

Buffers may be any of the image formats supported by sharp. For raw pixel
input, the `options` object should contain a `raw` attribute, which follows
the format of the attribute of the same name in the `sharp()` constructor.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
images| `Array.<(string|Buffer)>` | `string` | `Buffer`| one or more images (file paths, Buffers).  
options| `Object`| image options, see `sharp()` constructor.  
  
## bandbool

> bandbool(boolOp) ⇒ `Sharp`

Perform a bitwise boolean operation on all input image channels (bands) to
produce a single channel output image.

**Throws** :

  * `Error` Invalid parameters

Param| Type| Description  
---|---|---  
boolOp| `string`| one of `and`, `or` or `eor` to perform that bitwise
operation, like the C logic operators `&`, `  
  
**Example**

    
    
    sharp('3-channel-rgb-input.png')
    
      .bandbool(sharp.bool.and)
    
      .toFile('1-channel-output.png', function (err, info) {
    
        // The output will be a single channel image where each pixel `P = R & G & B`.
    
        // If `I(1,1) = [247, 170, 14] = [0b11110111, 0b10101010, 0b00001111]`
    
        // then `O(1,1) = 0b11110111 & 0b10101010 & 0b00001111 = 0b00000010 = 2`.
    
      });

[ Previous  
Colour manipulation ](/api-colour/) [ Next  
Global properties ](/api-utility/)

# Global properties | sharp

# Global properties

## versions

> versions

An Object containing the version numbers of sharp, libvips and (when using
prebuilt binaries) its dependencies.

**Example**

    
    
    console.log(sharp.versions);

## interpolators

> interpolators : `enum`

An Object containing the available interpolators and their proper values

**Read only** : true  
**Properties**

Name| Type| Default| Description  
---|---|---|---  
nearest| `string`| `”nearest”`| [Nearest neighbour
interpolation](https://en.wikipedia.org/wiki/Nearest-neighbor_interpolation).
Suitable for image enlargement only.  
bilinear| `string`| `”bilinear”`| [Bilinear
interpolation](https://en.wikipedia.org/wiki/Bilinear_interpolation). Faster
than bicubic but with less smooth results.  
bicubic| `string`| `”bicubic”`| [Bicubic
interpolation](https://en.wikipedia.org/wiki/Bicubic_interpolation) (the
default).  
locallyBoundedBicubic| `string`| `”lbb”`| [LBB
interpolation](https://github.com/libvips/libvips/blob/master/libvips/resample/lbb.cpp#L100).
Prevents some “[acutance](https://en.wikipedia.org/wiki/Acutance)” but
typically reduces performance by a factor of 2.  
nohalo| `string`| `”nohalo”`| [Nohalo
interpolation](http://eprints.soton.ac.uk/268086/). Prevents acutance but
typically reduces performance by a factor of 3.  
vertexSplitQuadraticBasisSpline| `string`| `”vsqbs”`| [VSQBS
interpolation](https://github.com/libvips/libvips/blob/master/libvips/resample/vsqbs.cpp#L48).
Prevents “staircasing” when enlarging.  
  
## format

> format ⇒ `Object`

An Object containing nested boolean values representing the available input
and output formats/methods.

**Example**

    
    
    console.log(sharp.format);

## queue

> queue

An EventEmitter that emits a `change` event when a task is either:

  * queued, waiting for _libuv_ to provide a worker thread
  * complete

**Example**

    
    
    sharp.queue.on('change', function(queueLength) {
    
      console.log('Queue contains ' + queueLength + ' task(s)');
    
    });

## cache

> cache([options]) ⇒ `Object`

Gets or, when options are provided, sets the limits of _libvips’_ operation
cache. Existing entries in the cache will be trimmed after any change in
limits. This method always returns cache statistics, useful for determining
how much working memory is required for a particular task.

Param| Type| Default| Description  
---|---|---|---  
[options]| `Object` | `boolean`| `true`| Object with the following attributes, or boolean where true uses default cache settings and false removes all caching  
[options.memory]| `number`| `50`| is the maximum memory in MB to use for this
cache  
[options.files]| `number`| `20`| is the maximum number of files to hold open  
[options.items]| `number`| `100`| is the maximum number of operations to cache  
  
**Example**

    
    
    const stats = sharp.cache();

**Example**

    
    
    sharp.cache( { items: 200 } );
    
    sharp.cache( { files: 0 } );
    
    sharp.cache(false);

## concurrency

> concurrency([concurrency]) ⇒ `number`

Gets or, when a concurrency is provided, sets the maximum number of threads
_libvips_ should use to process _each image_. These are from a thread pool
managed by glib, which helps avoid the overhead of creating new threads.

This method always returns the current concurrency.

The default value is the number of CPU cores, except when using glibc-based
Linux without jemalloc, where the default is `1` to help reduce memory
fragmentation.

A value of `0` will reset this to the number of CPU cores.

Some image format libraries spawn additional threads, e.g. libaom manages its
own 4 threads when encoding AVIF images, and these are independent of the
value set here.

The maximum number of images that sharp can process in parallel is controlled
by libuv’s `UV_THREADPOOL_SIZE` environment variable, which defaults to 4.

<https://nodejs.org/api/cli.html#uv_threadpool_sizesize>

For example, by default, a machine with 8 CPU cores will process 4 images in
parallel and use up to 8 threads per image, so there will be up to 32
concurrent threads.

**Returns** : `number` \- concurrency

Param| Type  
---|---  
[concurrency]| `number`  
  
**Example**

    
    
    const threads = sharp.concurrency(); // 4
    
    sharp.concurrency(2); // 2
    
    sharp.concurrency(0); // 4

## counters

> counters() ⇒ `Object`

Provides access to internal task counters.

  * queue is the number of tasks this module has queued waiting for _libuv_ to provide a worker thread from its pool.
  * process is the number of resize tasks currently being processed.

**Example**

    
    
    const counters = sharp.counters(); // { queue: 2, process: 4 }

## simd

> simd([simd]) ⇒ `boolean`

Get and set use of SIMD vector unit instructions. Requires libvips to have
been compiled with highway support.

Improves the performance of `resize`, `blur` and `sharpen` operations by
taking advantage of the SIMD vector unit of the CPU, e.g. Intel SSE and ARM
NEON.

Param| Type| Default  
---|---|---  
[simd]| `boolean`| `true`  
  
**Example**

    
    
    const simd = sharp.simd();
    
    // simd is `true` if the runtime use of highway is currently enabled

**Example**

    
    
    const simd = sharp.simd(false);
    
    // prevent libvips from using highway at runtime

## block

> block(options)

Block libvips operations at runtime.

This is in addition to the `VIPS_BLOCK_UNTRUSTED` environment variable, which
when set will block all “untrusted” operations.

**Since** : 0.32.4

Param| Type| Description  
---|---|---  
options| `Object`|  
options.operation| `Array.<string>`| List of libvips low-level operation names
to block.  
  
**Example** _(Block all TIFF input.)_

    
    
    sharp.block({
    
      operation: ['VipsForeignLoadTiff']
    
    });

## unblock

> unblock(options)

Unblock libvips operations at runtime.

This is useful for defining a list of allowed operations.

**Since** : 0.32.4

Param| Type| Description  
---|---|---  
options| `Object`|  
options.operation| `Array.<string>`| List of libvips low-level operation names
to unblock.  
  
**Example** _(Block all input except WebP from the filesystem.)_

    
    
    sharp.block({
    
      operation: ['VipsForeignLoad']
    
    });
    
    sharp.unblock({
    
      operation: ['VipsForeignLoadWebpFile']
    
    });

**Example** _(Block all input except JPEG and PNG from a Buffer or Stream.)_

    
    
    sharp.block({
    
      operation: ['VipsForeignLoad']
    
    });
    
    sharp.unblock({
    
      operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer']
    
    });

[ Previous  
Channel manipulation ](/api-channel/) [ Next  
Performance ](/performance/)

