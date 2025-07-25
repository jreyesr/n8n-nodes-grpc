# n8n-nodes-_node-name_

This is an n8n community node. It lets you use _app/service name_ in your n8n workflows.

_App/service name_ is _one or two sentences describing the service this node integrates with_.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  <!-- delete if no auth needed -->  
[Compatibility](#compatibility)  
[Usage](#usage)  <!-- delete if not using this section -->  
[Resources](#resources)  
[Version history](#version-history)  <!-- delete if not using this section -->

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community
nodes documentation.

## Operations

_List the operations supported by your node._

## Credentials

_If users need to authenticate with the app/service, provide details here. You should include prerequisites (such as
signing up with the service), available authentication methods, and how to set them up._

## Compatibility

_State the minimum n8n version, as well as which versions you test against. You can also include any known version
incompatibility issues._

## Usage

_This is an optional section. Use it to help users with any difficult or confusing aspects of the node._

_By the time users are looking for community nodes, they probably already know n8n basics. But if you expect new users,
you can link to the [Try it out](https://docs.n8n.io/try-it-out/) documentation to help them get started._

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* _Link to app/service documentation._

## Development

If for some reason you need to recreate the files for the standard Reflection service (though they haven't changed in
years and so should be stable):

1. Download the up-to-date file
	 from <https://github.com/grpc/grpc-proto/blob/master/grpc/reflection/v1/reflection.proto>, place it on
	 `./nodes/gRPCNode`
2. Install `npm install -g grpc-tools grpc_tools_node_protoc_ts`
3. Run
	 `grpc_tools_node_protoc --js_out=import_style=commonjs,binary:. --grpc_out=grpc_js:. --ts_out=. ./nodes/gRPCNode/*.proto`
4. You should see the four files `reflection(_grpc)?_pb.(.js|.d.ts)` being created/updated

## Version history

_This is another optional section. If your node has multiple versions, include a short description of available versions
and what changed, as well as any compatibility impact._


