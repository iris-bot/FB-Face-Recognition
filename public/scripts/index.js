// index.js

var REST_DATA = 'api/faces';

function encodeUriAndQuotes(untrustedStr) {
    return encodeURI(String(untrustedStr)).replace(/'/g, '%27').replace(')', '%29');
}

function loadItems() {
	showLoadingMessage();

    xhrGet(REST_DATA, function(data) {
		console.log(data);

        for (var i = 0; i < data.length; ++i) {
            addItem(data[i]);
        }
        
        //stop showing loading message
        stopLoadingMessage();
    }, function(err) {
        console.error(err);
        //stop showing loading message
        stopLoadingMessage();
    });
}

function setRowContent(item, row) {
	console.log(item);
    var innerHTML = "<td class='contentName'>";
    
    if(item.value){
    	if(item.value.fbid){
    		innerHTML += "<div>" + (item.value.fbid>0 ? "<a href='http://facebook.com/"+item.value.fbid+"' target='_blank'>"+item.name+"</a>" : item.name) + "</div>";
    	}
		
		innerHTML += "<div>"+dumpObj(item.value)+"</div>";
		
    }
	
	innerHTML += "</td><td class='contentDetails'><div id='pics"+item.id+"' class='flexBox'>";

	for(var i in item.attachements){
		var attach = item.attachements[i];
		var tooltip = item.trace[i].date + " | " + item.trace[i].latitude + " | " + item.trace[i].longitude;
        innerHTML += "<div class='contentTiles'><img height=\"50\" src=\"" + encodeUriAndQuotes(attach.url) + "\" title='"+tooltip+"'></div>";
	}

    innerHTML += "<div class='contentTiles'><a href='javascript:loadMore(\""+item.id+"\")'>ver mais...</a></div>";
	
    innerHTML += "</div>";

    row.innerHTML = innerHTML + "</td><td class = 'contentAction'><span class='deleteBtn' onclick='deleteItem(this)' title='delete me'></span></td>";

}

function dumpObj(item){
	var str = "";
	if(isObject(item)){
		for(var k in item){
			str+="<div style='display:inline-block'>"+k+": "+dumpObj(item[k])+"</div>";
		}
	}else if(item){
		str+=item;
	}
	return str;
}

function addItem(item) {

    var row = document.createElement('tr');
    row.className = "tableRows";
    var id = item && item.id;
    if (id) {
        row.setAttribute('data-id', id);
    }

    if (item){
        setRowContent(item, row);
    }
    
    var table = document.getElementById('notes');
    table.lastChild.appendChild(row);

}

function deleteItem(deleteBtnNode) {
    var row = deleteBtnNode.parentNode.parentNode;
    var attribId = row.getAttribute('data-id');
    if (attribId) {
        xhrDelete(REST_DATA + '?id=' + row.getAttribute('data-id'), function() {
            row.parentNode.removeChild(row);
        }, function(err) {
            console.error(err);
        });
    } else if (attribId == null) {
        row.parentNode.removeChild(row);
    }
}

function loadMore(attribId) {
    xhrGet(REST_DATA + '?id=' + attribId, 
    function(data) {
        var item = data[0];
        var innerHTML = "";
		for(var i in item.attachements){
			var attach = item.attachements[i];
			var tooltip = item.trace[i].date + " | " + item.trace[i].latitude + " | " + item.trace[i].longitude;
	        innerHTML += "<div class='contentTiles'><img height=\"50\" src=\"" + encodeUriAndQuotes(attach.url) + "\" title='"+tooltip+"'></div>";
		}
        document.getElementById("pics"+item.id).innerHTML = innerHTML;
    }, 
    function(err) {
        console.error(err);
    });
}

function isObject(val) {
    if (val === null) { return false;}
    return ( (typeof val === 'function') || (typeof val === 'object') );
}

function showLoadingMessage() {
    document.getElementById('loadingImage').innerHTML = "Loading data " + "<img height=\"100\" width=\"100\" src=\"images/loading.gif\"></img>";
}

function stopLoadingMessage() {
    document.getElementById('loadingImage').innerHTML = "";
}

