/* Plural format accessors. Apps Script returns a 2D array with one entry PER CELL,
   while the engine exposes a single value for the whole range (null when mixed).
   We therefore iterate cell-by-cell: slower, but it is what Apps Script returns. */
Range.prototype._eachCell = function (fn) {
  var d = this._dims(), origin = cellRef(this.getA1Notation().split(":")[0]);
  var out = [];
  for (var r = 0; r < d.rows; r++) {
    var row = [];
    for (var c = 0; c < d.cols; c++)
      row.push(fn(new Range(this._sid, colName(origin.col + c) + (origin.row + r))));
    out.push(row);
  }
  return out;
};
Range.prototype._applyCells = function (values, fn) {
  var origin = cellRef(this.getA1Notation().split(":")[0]);
  for (var r = 0; r < values.length; r++)
    for (var c = 0; c < values[r].length; c++)
      fn(new Range(this._sid, colName(origin.col + c) + (origin.row + r)), values[r][c]);
  return this;
};
/* singular name -> plural name, derived from the already-implemented singulars */
[["getFontWeight","getFontWeights","setFontWeight","setFontWeights"],
 ["getFontStyle","getFontStyles","setFontStyle","setFontStyles"],
 ["getFontSize","getFontSizes","setFontSize","setFontSizes"],
 ["getFontColor","getFontColors","setFontColor","setFontColors"],
 ["getFontFamily","getFontFamilies","setFontFamily","setFontFamilies"],
 ["getBackground","getBackgrounds","setBackground","setBackgrounds"],
 ["getHorizontalAlignment","getHorizontalAlignments","setHorizontalAlignment","setHorizontalAlignments"],
 ["getVerticalAlignment","getVerticalAlignments","setVerticalAlignment","setVerticalAlignments"],
 ["getWrap","getWraps","setWrap","setWraps"],
 ["getFontLine","getFontLines","setFontLine","setFontLines"]
].forEach(function (d) {
  var getOne = d[0], getMany = d[1], setOne = d[2], setMany = d[3];
  Range.prototype[getMany] = function () {
    return this._eachCell(function (cell) { return cell[getOne](); }); };
  Range.prototype[setMany] = function (vs) {
    return this._applyCells(vs, function (cell, v) { cell[setOne](v); }); };
});
Range.prototype.getFontLine = function () {
  if (this._fmt("font", "strikethrough", null, true)) return "line-through";
  var u = this._fmt("font", "underline", null, true);
  return (u && u !== "None") ? "underline" : "none";
};
Range.prototype.setBackgroundRGB = function (r, g, b) {
  return this.setBackground("#" + [r, g, b].map(function (n) {
    return ("0" + Number(n).toString(16)).slice(-2); }).join("")); };
Range.prototype.getBackgroundObject = function () {
  var c = this.getBackground(); return c ? new Color(ColorType.RGB, new RgbColor(c)) : null; };
Range.prototype.setBackgroundObject = function (c) {
  return this.setBackground(c && c.asRgbColor ? c.asRgbColor().asHexString() : c); };
/* Font Color objects retain theme identity; the string getter resolves to RGB. */
Range.prototype.getFontColorObject = function () {
  if(this._isSpanShadow())return new Color(ColorType.RGB,new RgbColor("#000000"));
  var raw=this._fmt("font","color",null,true),m=/^theme:(.*)$/i.exec(String(raw));
  if(m){var name=m[1].toUpperCase(),aliases={DARK1:"TEXT",TEXT1:"TEXT",LIGHT1:"BACKGROUND",LT1:"BACKGROUND",BACKGROUND1:"BACKGROUND"};name=aliases[name]||name;
    if(ThemeColorType[name])return new Color(ColorType.THEME,new ThemeColorValue(ThemeColorType[name]));}
  return new Color(ColorType.RGB,new RgbColor(asColor(raw)||"#000000"));
};
Range.prototype.setFontColorObject = function (c) {
  if(c && c.getColorType && c.getColorType()===ColorType.THEME){var n=String(c.asThemeColor().getThemeColorType()).toLowerCase();
    return this._fmt("font","color","theme:"+({text:"dark1",background:"light1"}[n]||n));}
  return this.setFontColor(c && c.asRgbColor ? c.asRgbColor().asHexString() : c);
};
Range.prototype.getBackgroundObjects = function () {
  return this._eachCell(function (c) { return c.getBackgroundObject(); }); };
Range.prototype.getFontColorObjects = function () {
  return this._eachCell(function (c) { return c.getFontColorObject(); }); };
Range.prototype.setBackgroundObjects = function (vs) {
  return this._applyCells(vs, function (c, v) { c.setBackgroundObject(v); }); };
Range.prototype.setFontColorObjects = function (vs) {
  return this._applyCells(vs, function (c, v) { c.setFontColorObject(v); }); };
Range.prototype.getNumberFormats = function () {
  return this._eachCell(function (c) { return c.getNumberFormat(); }); };   /* already normalised */

/* Bulk plural formatting reads, preserving the existing singular getter semantics.
   Review snapshots call several getters on the SAME Range. Fetch the raw font and
   alignment fields once per range/revision, then let singular getters interpret them.
   This avoids hundreds of thousands of interpreter/engine crossings on large sheets. */
Range.prototype._formatSnapshot = function () {
  var version=GAS.revision();
  if(this._formatCache && this._formatCache.version===version)return this._formatCache;
  var origin=cellRef(this._boundedA1().split(":")[0]),d=this._dims(),sid=this._sid;
  var b=this._bind(function(id){return [{op:"load",id:id,properties:["values","numberFormat"]}];});
  var values=GAS.apply(b.ops).loaded[b.id];
  /* Formats are read by recursive subdivision, not cell by cell. mog answers a multi-cell
     getRangeFormat the way Excel does: a property uniform across the range comes back with
     its value, a property that varies comes back null. An unformatted range returns the
     DEFAULT ("#000000", "Calibri", 11), never null -- verified directly -- so null means
     "mixed" and nothing else. A non-null answer therefore states that every cell in the
     rectangle holds that value, which makes this exactly equivalent to asking each cell,
     while a uniformly formatted region costs one query instead of one per cell.
     The old per-cell walk cost 5 ops per cell and made task_03's baseline capture 286s. */
  var FONT=["bold","italic","size","name","color","underline","strikethrough"],
      FMT=["horizontalAlignment","verticalAlignment"];
  var cells=new Array(d.rows*d.cols);
  for(var i=0;i<cells.length;i++)cells[i]={font:{},format:{}};
  function assign(blk,kind,prop,val){
    for(var r=blk.r;r<blk.r+blk.rows;r++)for(var c=blk.c;c<blk.c+blk.cols;c++)
      cells[r*d.cols+c][kind][prop]=val;
  }
  var queue=[{r:0,c:0,rows:d.rows,cols:d.cols,font:FONT.slice(),format:FMT.slice()}];
  while(queue.length){
    var level=queue,next=[];
    /* Cap ops per round-trip; each block costs at most five. */
    for(var s=0;s<level.length;s+=400){
      var slice=level.slice(s,s+400),ops=[],meta=[];
      slice.forEach(function(blk){
        var rid=GAS.nid(),fid=GAS.nid(),gid=GAS.nid();
        var a1=colName(origin.col+blk.c)+(origin.row+blk.r)+":"+
               colName(origin.col+blk.c+blk.cols-1)+(origin.row+blk.r+blk.rows-1);
        ops.push({op:"getRange",id:rid,worksheetId:sid,address:a1});
        if(blk.font.length)ops.push({op:"getRangeFormat",id:fid,rangeId:rid,kind:"font"},
          {op:"load",id:fid,properties:blk.font});
        if(blk.format.length)ops.push({op:"getRangeFormat",id:gid,rangeId:rid,kind:"format"},
          {op:"load",id:gid,properties:blk.format});
        meta.push({blk:blk,fid:fid,gid:gid});
      });
      var loaded=GAS.apply(ops).loaded;
      meta.forEach(function(m){
        var blk=m.blk,single=blk.rows===1 && blk.cols===1,restF=[],restG=[];
        blk.font.forEach(function(p){
          var v=(loaded[m.fid]||{})[p];
          /* A single cell is definitive even when the answer is null. */
          if(v!==null || single)assign(blk,"font",p,v===undefined?null:v);else restF.push(p);
        });
        blk.format.forEach(function(p){
          var v=(loaded[m.gid]||{})[p];
          if(v!==null || single)assign(blk,"format",p,v===undefined?null:v);else restG.push(p);
        });
        if(!restF.length && !restG.length)return;
        /* Split the longer side so blocks stay compact. */
        if(blk.rows>=blk.cols){
          var h=Math.floor(blk.rows/2);
          next.push({r:blk.r,c:blk.c,rows:h,cols:blk.cols,font:restF,format:restG});
          next.push({r:blk.r+h,c:blk.c,rows:blk.rows-h,cols:blk.cols,font:restF,format:restG});
        }else{
          var w=Math.floor(blk.cols/2);
          next.push({r:blk.r,c:blk.c,rows:blk.rows,cols:w,font:restF,format:restG});
          next.push({r:blk.r,c:blk.c+w,rows:blk.rows,cols:blk.cols-w,font:restF,format:restG});
        }
      });
    }
    queue=next;
  }
  this._formatCache={version:version,rows:d.rows,cols:d.cols,origin:origin,cells:cells,values:datify(values.values,values.numberFormat)};
  return this._formatCache;
};
Range.prototype._eachFormatCell = function (getter) {
  var cache=this._formatSnapshot(),out=[];
  for(var r=0;r<cache.rows;r++){
    var row=[];
    for(var c=0;c<cache.cols;c++){
      var cell=new Range(this._sid,colName(cache.origin.col+c)+(cache.origin.row+r));
      (function(cell,fields,value){
        cell._fmt=function(kind,property,ignored,read){
          if(read && fields[kind] && Object.prototype.hasOwnProperty.call(fields[kind],property))return fields[kind][property];
          return Range.prototype._fmt.apply(this,arguments);
        };
        cell.getValue=function(){return value;};
      })(cell,cache.cells[r*cache.cols+c],cache.values[r][c]);
      row.push(cell[getter]());
    }
    out.push(row);
  }
  return out;
};
[["getFontWeights","getFontWeight"],["getFontStyles","getFontStyle"],
 ["getFontSizes","getFontSize"],["getFontFamilies","getFontFamily"],
 ["getFontColors","getFontColor"],["getFontColorObjects","getFontColorObject"],
 ["getFontLines","getFontLine"],["getHorizontalAlignments","getHorizontalAlignment"],
 ["getVerticalAlignments","getVerticalAlignment"],["getWraps","getWrap"]].forEach(function(pair){
  Range.prototype[pair[0]]=function(){return this._eachFormatCell(pair[1]);};
});
Range.prototype.getNumberFormats=function(){return this._load("numberFormat").map(function(row){return row.map(asNumberFormat);});};
