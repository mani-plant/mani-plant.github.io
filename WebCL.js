function GPU(ctx = null, log = false){
	this.log = log;
	//this.log=true;
	var gpu = this;
	var settings = {'autocompile': true};
	this.setSettings = function(newsettings){
		for(s in newsettings){
			settings[s] = newsettings[s];
		}
	}
	var initGL = function(canvas) {
		var gl = null;
		var attr = {alpha : false, antialias : false};
		gl = canvas.getContext("webgl2", attr);
		if (!gl)
			throw new Error("Unable to initialize WebGL2.");
		return gl;
	}
	this.ctx = ctx;
	if(this.ctx == null)
		this.ctx = document.createElement('canvas');
		
	var gl = initGL(this.ctx);
	if (!(flext = gl.getExtension('EXT_color_buffer_float')))
		throw new Error('Error: EXT_color_buffer_float not supported.');
	var max_texture_size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
	var max_texture_units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
	var max_color_units = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS);
	function newBuffer(data, f, e) {
		var buf = gl.createBuffer();
		gl.bindBuffer((e || gl.ARRAY_BUFFER), buf);
		gl.bufferData((e || gl.ARRAY_BUFFER), new (f || Float32Array)(data), gl.STATIC_DRAW);
		return buf;
	}
	var chnlMap = {
		1:{
			internal_format: gl.R32F,
			format: gl.RED,
			type: gl.FLOAT,
			stype: 'float'
		},
		2:{
			internal_format: gl.RG32F,
			format: gl.RG,
			type: gl.FLOAT,
			stype: 'vec2'
		},
		3:{
			internal_format: gl.RGB32F,
			format: gl.RGB,
			type: gl.FLOAT,
			stype: 'vec3'
		},
		4:{
			internal_format: gl.RGBA32F,
			format: gl.RGBA,
			type: gl.FLOAT,
			stype: 'vec4'
		}
	}
	console.log(chnlMap);
	var positionBuffer = newBuffer([ -1, -1, 1, -1, 1, 1, -1, 1 ]);
	var textureBuffer  = newBuffer([  0,  0, 1,  0, 1, 1,  0, 1 ]);
	var indexBuffer    = newBuffer([  1,  2, 0,  3, 0, 2 ], Uint16Array, gl.ELEMENT_ARRAY_BUFFER);
	var vertexShaderCode = "#version 300 es"+
	"\n"+
	"in vec2 position;\n" +
	"out vec2 pos;\n" +
	"in vec2 texture;\n" +
	"\n" +
	"void main(void) {\n" +
	"  pos = texture;\n" +
	"  gl_Position = vec4(position.xy, 0.0, 1.0);\n" +
	"}";
	var vertexShader = gl.createShader(gl.VERTEX_SHADER);
	gl.shaderSource(vertexShader, vertexShaderCode);
	gl.compileShader(vertexShader);
	if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
		throw new Error(
			"\nError: Vertex shader build failed\n" + "\n" +
			"--- CODE DUMP ---\n" + vertexShaderCode + "\n\n" +
			"--- ERROR LOG ---\n" + gl.getShaderInfoLog(vertexShader)
		);
	function createTexture(data, size, formats) {
		var texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		console.log(size);
		gl.texImage2D(gl.TEXTURE_2D, 0, formats.internal_format, size, size, 0, formats.format, formats.type, data);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return texture;
	}
	function updateTexture(texture, size, formats, data){
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, formats.internal_format, size, size, 0, formats.format, formats.type, data);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return texture;
	}
	function Buffer(size, chnl=1, data=null){
		this.length = size;
		this.chnl = chnl;
		this.formats = chnlMap[chnl];
		this.mem = Math.pow(4, Math.ceil(Math.log(this.length) / Math.log(4)));
		if (Math.sqrt(this.mem) > max_texture_size)
			throw new Error("ERROR: Texture size not supported!");
		this.data = new Float32Array(this.mem*this.chnl);
		if(data && data.length){
			for(var i=0;i<data.length;i++){
				this.data[i] = data[i];
			}
		}
		this.setData = function(nd, writeafter=false){
			for(var i=0;i<this.length;i++){
				this.data[i] = nd[i];
			}
			if(writeafter){
				this.write();
			}
		}
		this.mem = Math.sqrt(this.mem);
		this.texture = null;
		this.alloc = function(){
			if(this.texture == null)
				this.texture = createTexture(this.data, this.mem, this.formats);
			return this.texture;
		}
		this.write = function(){
			if(this.texture == null)
				this.alloc();
			else
				this.texture = updateTexture(this.texture, this.mem, this.formats, this.data);
		}
		this.read = function(){
			if(this.texture == null) throw Error("Buffer not allocated in GPU");
			var fb = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE) {
				gl.readBuffer(gl.COLOR_ATTACHMENT0);
				gl.readPixels(0, 0, this.mem, this.mem, this.formats.format, this.formats.type, this.data);
			}
			gl.deleteFramebuffer(fb);
		}
		this.delete = function(){
			if(this.texture != null)
				gl.deleteTexture(this.texture);
			this.texture = null;
		}
		this.copyShader = function(buf, offset = 0, read=false){
			if(gpu.log) console.log(this);
			if(this.texture == null) throw Error("Buffer not allocated in GPU");
			var cpyPrgm = `void main(void) {\n`;
			for(var i=0;i<buf.length;i++){
				cpyPrgm += `out${i} = readI(0, getIndex() + ${offset}. );\n`;
			}
			cpyPrgm += '}';
			var prgm = gpu.Program([this],buf,cpyPrgm);
			prgm.exec(read);
			return buf;
		}
		this.draw = function(){
			if(this.texture == null) throw Error("Buffer not allocated in GPU");
			var cpyPrgm = `void main(void) {\n`;
			for(var i=0;i<1;i++){
				cpyPrgm += `out${i} = readIRGBA(0, getIndex() );\n`;
			}
			cpyPrgm += '}';
			var prgm = gpu.Program([this],[this],cpyPrgm);
			prgm.exec(false, null, true);
		}
		this.copy = function(bufs, read=false){
			if(this.texture == null) throw Error("Buffer not allocated in GPU");
			var fb = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
			gl.readBuffer(gl.COLOR_ATTACHMENT0);
			for(var i=0;i<bufs.length;i++){
				var buf=bufs[i];
				if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE) {
					gl.copyTexImage2D(gl.TEXTURE_2D, 0, buf.formats.internal_format, 0, 0, buf.mem, buf.mem, 0);
					if(read)
						gl.readPixels(0, 0, buf.mem, buf.mem, buf.formats.format, buf.formats.type, buf.data);
				}
			}
			gl.deleteFramebuffer(fb);
		}

	}
	function Program(inp, op, code){
		this.inp = inp;
		this.op = op;
		if(inp.length +op.length > max_texture_units + max_color_units){
			return false;
		}
		var sizeI = [];	
		var texcode = 'uniform sampler2D u_texture['+this.inp.length+'];\n';
		for(let i=0;i<this.inp.length; i++){
			sizeI.push(this.inp[i].mem);
		}
		texcode += 'float size['+this.inp.length+'] = float[]('+sizeI.join('.,')+'.);\n';
		var sizeO = this.op[0].mem;
		var opcode = '';
		var comcode = '';
		for(let i=0;i<this.op.length;i++){
			opcode += 'layout(location = '+i+') out '+this.op[i].formats.stype+' out'+i+';\n';
			comcode += 'out'+i+' = op['+i+'];\n';
		}
		if(this.inp.length <= 0){
			texcode = '';
		}else{
			texcode += `
		float getR(int i, vec2 coord) {
		  return texture(u_texture[i], coord).r;
		}
		float getG(int i, vec2 coord) {
		  return texture(u_texture[i], coord).g;
		}
		float getB(int i, vec2 coord) {
		  return texture(u_texture[i], coord).b;
		}
		float getA(int i, vec2 coord) {
		  return texture(u_texture[i], coord).a;
		}
		vec2 getRG(int i, vec2 coord) {
		  return texture(u_texture[i], coord).rg;
		}
		vec3 getRGB(int i, vec2 coord) {
		  return texture(u_texture[i], coord).rgb;
		}
		vec4 getRGBA(int i, vec2 coord) {
		  return texture(u_texture[i], coord).rgba;
		}
		vec2 getInd(int i, float index){
   			float y = float(int(index)/int(size[i]));
   			float x = index - size[i]*y;
   			return vec2(x,y);
   		}
   		vec2 getPos(int i, vec2 ind){
   			return (ind + 0.5)/size[i];
   		}
   		float readIR(int i, float index){
   			return getR(i, getPos(i, getInd(i, index)));
   		}
   		float readI(int i, float index){
   			return getR(i, getPos(i, getInd(i, index)));
   		}
   		float readIG(int i, float index){
   			return getG(i, getPos(i, getInd(i, index)));
   		}
   		float readIB(int i, float index){
   			return getB(i, getPos(i, getInd(i, index)));
   		}
   		float readIA(int i, float index){
   			return getA(i, getPos(i, getInd(i, index)));
   		}
   		vec2 readIRG(int i, float index){
   			return getRG(i, getPos(i, getInd(i, index)));
   		}
   		vec3 readIRGB(int i, float index){
   			return getRGB(i, getPos(i, getInd(i, index)));
   		}
   		vec4 readIRGBA(int i, float index){
   			return getRGBA(i, getPos(i, getInd(i, index)));
   		}`
		}
		this.stdlib = `#version 300 es
		precision mediump float;
		float sizeO = ${sizeO}.;

		in vec2 pos;
		${opcode}
		
		vec2 indXY(){
   			return pos*sizeO - 0.5 ;
   		}
   		float getIndex(){
   			vec2 ind = indXY();
   			return (ind.y*sizeO + ind.x);
   		}

   		${texcode}
		`;
		//console.log(this.stdlib);
		var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
		this.fscode = code;
		if(gpu.log) console.log(this.stdlib + this.fscode);
		gl.shaderSource(
			fragmentShader,
			this.stdlib + this.fscode
		);
		var compiled = false;
		this.compile = function(){
			compiled = true;
			gl.compileShader(fragmentShader);
			if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
				var LOC = code.split('\n');
				var dbgMsg = "ERROR: Could not build shader (fatal).\n\n------------------ KERNEL CODE DUMP ------------------\n"
				for (var nl = 0; nl < LOC.length; nl++)
					dbgMsg += (this.stdlib.split('\n').length + nl) + "> " + LOC[nl] + "\n";
				dbgMsg += "\n--------------------- ERROR  LOG ---------------------\n" + gl.getShaderInfoLog(fragmentShader)
				throw new Error(dbgMsg);
			}
			this.program = gl.createProgram();
			gl.attachShader(this.program, vertexShader);
			gl.attachShader(this.program, fragmentShader);
		}
		if(settings.autocompile){
			this.compile();
		}
		this.exec = function(doTransfer = false, transi = null, draw = false){
			if(!compiled) throw new Error("Program not compiled!");
			gl.linkProgram(this.program);
			if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
				throw new Error('ERROR: Can not link GLSL program!'+gl.LINK_STATUS);
			var v_texture = [];
			for(let i=0;i<this.inp.length;i++){
				v_texture.push(gl.getUniformLocation(this.program, 'u_texture['+i+']'));
			}
			var aPosition = gl.getAttribLocation(this.program, 'position');
			var aTexture = gl.getAttribLocation(this.program, 'texture');
			gl.viewport(0, 0, sizeO, sizeO);
			var fbo = gl.createFramebuffer();
			if(!draw){
				gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
				var colAt = [];
				for(let i=0;i<this.op.length;i++){
					if(this.op[i].texture == null) this.op[i].alloc();
					gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+i, gl.TEXTURE_2D, this.op[i].texture, 0);
					colAt.push(gl.COLOR_ATTACHMENT0+i);
				}
			}
			
			var frameBufferStatus = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE);
			if (!frameBufferStatus)
				throw new Error('ERROR: ' + frameBufferStatus.message);
			gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
			gl.enableVertexAttribArray(aTexture);
			gl.vertexAttribPointer(aTexture, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.enableVertexAttribArray(aPosition);
			gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

			if(!draw) gl.drawBuffers(colAt);


			gl.useProgram(this.program);
			for(let i=0;i<this.inp.length;i++){
				gl.activeTexture(gl.TEXTURE0+i);
				gl.bindTexture(gl.TEXTURE_2D, this.inp[i].texture);
				gl.uniform1i(v_texture[i], i);
			}
			
			gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
			if(doTransfer){
				if(transi === null){
					for(let i=0;i<this.op.length;i++){
						gl.readBuffer(gl.COLOR_ATTACHMENT0+i);
						gl.readPixels(0, 0, sizeO, sizeO, this.op[i].formats.format, this.op[i].formats.type, this.op[i].data);
					}
				}else{
					var i = transi;
					gl.readBuffer(gl.COLOR_ATTACHMENT0+i);
					gl.readPixels(0, 0, sizeO, sizeO, this.op[i].formats.format, this.op[i].formats.type, this.op[i].data);
				}
			}
			gl.deleteFramebuffer(fbo);
		}
		
	}

	this.Buffer = function(size, chnl, data){
		return new Buffer(size, chnl, data);
	}

	this.Program = function(inp, op, code){
		return new Program(inp, op, code);
	}
}

function ExecGraph(){
	// var shader = `
	// #define inputBuffer 0
	// #define paramBuffer 1
	// #define outputBuffer 2
	// `;
	
	var Activation = function(){
		/*
			dtype = 'int','float'
		*/
		this.stack = [];
		this.shader = '';
		this.operator = function(op,y,x,dtype){
			return(dtype+' '+ y + ' op ' + x+';');
		}
		this.func = function(op, params){
			return(op+"("+params.join(",")+");");
		}
		this.read = function(buffer, index, chnl = 1){
			return('readIR('+buffer+', float('+index+'));');
		}
		this.write = function(index, val, chnl = 1){
			return('out'+index+' = '+val+';');
		}
		this.push = function(act){
			this.stack.push(act);
			return this;
		}
		this.compile = function(){
			this.shader = this.stack.join('');
			return this.shader;
		}
	}

	var Graph = function(activation, nodes){
		this.nodes = nodes;
		this.activation = activation;
		var graph = this;
		var gpu = new GPU();
		var lenInp = 0;
		var lenParam = 0;
		var lenControl = 0;
		var lenOut = nodes.length;
		var lenCNodes = 0;
		var paramBufferTmp = [];
		var opBuffer = [];
		for(var i=0;i<nodes.length;i++){
			paramBufferTmp = paramBufferTmp.concat(nodes[i].params);
			opBuffer.push(nodes[i].value);
		}
		var paramBuffer = gpu.Buffer(paramBufferTmp.length, 1, paramBufferTmp);
		opBuffer = gpu.Buffer(opBuffer.length, 1, opBuffer);
		var opBufferS = gpu.Buffer(opBuffer.length, 1, opBuffer);
		var inpBufferTmp = [];
		var inpBuffer = null;
		var prog = [];
		var inpBufs = null;
		var swapInpBuf = 0;
		opBuffer.alloc();
		paramBuffer.alloc();
		opBufferS.alloc();
		this.addProg = function(inp){
			inpBufs = [paramBuffer, opBuffer];
			inpBufsS = [paramBuffer, opBufferS];
			for(var i=0;i<inp.length;i++){
				inpBufferTmp = inpBufferTmp.concat(inp[i]);
			}
			
			if(inpBufferTmp.length > 0){
				inpDim = inp[0].length;
				inpBuffer = gpu.Buffer(inpBufferTmp.length, 1, inpBufferTmp);
				inpBuffer.alloc();
				inpBufs.push(inpBuffer);
				inpBufsS.push(inpBuffer);
			}else{
				inpDim = 0;
			}
			var fshader = 
			`void main(){
				int INPUT = 2;
				int PARAM = 0;
				int OUT = 1;
				${this.activation}
			}`;
			prog.push([gpu.Program(inpBufs, [opBufferS], fshader),gpu.Program(inpBufsS, [opBuffer], fshader)]);
			console.log(prog);
			this.exec = function(i=0, swap = true){
				if(prog[i][swapInpBuf] == null) throw Error('Null Program');
					else prog[i][swapInpBuf].exec();
				if(swap){
					graph.swap();
				}
			}
			this.read = function(){
				if(swapInpBuf){
					opBufferS.read();
					return opBufferS.data;
				}else{
					opBuffer.read();
					return opBuffer.data;
				}
			}
			this.swap = function(){
				swapInpBuf = (swapInpBuf+1)%2;
			}
		}
		
		
	}
	this.Graph = function(activation, nodes){
		return new Graph(activation, nodes);
	}
	this.Activation = function(){
		return new Activation();
	}
}



//GPU -> gives access to GPU
//Buffer -> Memory in GPU and CPU, copy buffers on gpu
//Program -> Program in GPU(init, compile, exec(link & exec))